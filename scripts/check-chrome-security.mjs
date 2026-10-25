import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {posix,resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';

// A regression guard for this extension's deliberately small package, not a
// general JavaScript security analyzer. Review new execution mechanisms manually.
export function checkChromeSecurity(manifest,files) {
  assert.equal(manifest.manifest_version,3);
  assert.equal(typeof manifest.content_security_policy,'object','MV3 CSP must be a dictionary');
  const policy=manifest.content_security_policy?.extension_pages;
  assert.equal(typeof policy,'string','An explicit extension_pages CSP is required');
  const directives=new Map();
  for(const part of policy.split(';').map(value=>value.trim()).filter(Boolean)) {
    const [name,...sources]=part.split(/\s+/);
    assert.equal(directives.has(name),false,`Duplicate CSP directive: ${name}`);
    directives.set(name,sources);
  }
  for(const [name,sources] of Object.entries({
    'default-src':["'self'"],'script-src':["'self'"],'object-src':["'none'"],
    'base-uri':["'none'"],'frame-ancestors':["'none'"],'form-action':["'none'"],
    // HTTPS image data is fetched as bytes, never imported as executable code.
    'connect-src':['https:']
  })) assert.deepEqual(directives.get(name),sources,`Unexpected CSP ${name}`);
  for(const name of ['script-src-elem','script-src-attr','worker-src','child-src']) {
    if(directives.has(name)) assert.ok(
      directives.get(name).length===1&&["'self'","'none'"].includes(directives.get(name)[0]),
      `CSP ${name} must not enable remote code or string execution`
    );
  }
  assert.equal(manifest.sandbox,undefined,'Sandbox execution requires a fresh security review');
  assert.equal(manifest.content_security_policy.sandbox,undefined,'Sandbox CSP requires a fresh security review');

  function resource(path,from,extension) {
    assert.ok(typeof path==='string'&&/^[\w./-]+$/.test(path)&&!path.startsWith('/'),`${from}: expected a packaged resource, got ${path}`);
    const target=posix.normalize(posix.join(posix.dirname(from),path));
    assert.ok(!target.startsWith('../')&&files.has(target),`${from}: missing packaged resource ${path}`);
    if(extension) assert.ok(target.endsWith(extension),`${from}: expected a ${extension} resource: ${path}`);
  }
  resource(manifest.background?.service_worker,'manifest.json','.js');
  for(const script of manifest.content_scripts??[]) {
    for(const path of script.js??[]) resource(path,'manifest.json','.js');
    for(const path of script.css??[]) resource(path,'manifest.json','.css');
  }
  for(const path of [manifest.options_page,manifest.options_ui?.page,manifest.action?.default_popup].filter(Boolean)) resource(path,'manifest.json','.html');

  const literal=node=>node&&(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))?node.text:undefined;
  const member=node=>ts.isIdentifier(node)?node.text:ts.isPropertyAccessExpression(node)?node.name.text:
    ts.isElementAccessExpression(node)?literal(node.argumentExpression):undefined;
  for(const [file,source] of files) {
    if(file.endsWith('.js')) {
      const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
      assert.equal(ast.parseDiagnostics.length,0,`${file}: invalid JavaScript`);
      function visit(node) {
        const name=member(node);
        // Reject references too, so ordinary aliases of these APIs are caught.
        assert.ok(!['eval','Function','WebAssembly'].includes(name),`${file}: ${name} execution is not allowed`);
        if(ts.isCallExpression(node)||ts.isNewExpression(node)) {
          const callee=member(node.expression),args=node.arguments??[];
          if(['setTimeout','setInterval'].includes(callee)) assert.equal(literal(args[0]),undefined,`${file}: string timer is not allowed`);
          if(callee==='executeScript') assert.fail(`${file}: programmatic injection requires a fresh security review; use manifest content scripts`);
          if(callee==='createElement'&&literal(args[0])?.toLowerCase()==='script') assert.fail(`${file}: dynamic script elements require a fresh security review`);
          if(callee==='importScripts'||node.expression.kind===ts.SyntaxKind.ImportKeyword||['Worker','SharedWorker'].includes(callee)) {
            const resources=callee==='importScripts'?args:args.slice(0,1);
            assert.ok(resources.length,`${file}: missing code resource`);
            for(const argument of resources) resource(literal(argument),file,'.js');
          }
        }
        if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier) resource(literal(node.moduleSpecifier),file,'.js');
        ts.forEachChild(node,visit);
      }
      visit(ast);
    }
    if(file.endsWith('.html')) {
      assert.equal(/\son\w+\s*=|\bjavascript\s*:|<\s*(?:iframe|object|embed|base)\b/i.test(source),false,`${file}: inline handlers or embedded execution are not allowed`);
      const scripts=[...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
      assert.equal(scripts.length,[...source.matchAll(/<script\b/gi)].length,`${file}: unclosed script element`);
      for(const tag of scripts) {
        const src=/(?:^|\s)src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag[1]);
        assert.ok(src&&!tag[2].trim(),`${file}: scripts must be packaged files, without inline code`);
        resource(src[1]??src[2]??src[3],file,'.js');
      }
      for(const tag of source.matchAll(/<link\b([^>]*)>/gi)) {
        const href=/(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag[1]);
        assert.ok(href,`${file}: link must reference a packaged resource`);
        resource(href[1]??href[2]??href[3],file);
      }
    }
    if(file.endsWith('.css')) {
      assert.equal(/@import\b/i.test(source),false,`${file}: bundle styles instead of importing them`);
      for(const match of source.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/gi)) resource(match[1]??match[2]??match[3],file);
    }
  }
}

export async function readChromePackage(directory=resolve('chrome-extension')) {
  const files=new Map();
  for(const entry of await readdir(directory,{recursive:true,withFileTypes:true})) {
    if(!entry.isFile()) continue;
    const path=join(entry.parentPath,entry.name);
    const relative=path.slice(directory.length+1).replaceAll('\\','/');
    files.set(relative,await readFile(path,'utf8'));
  }
  return {manifest:JSON.parse(files.get('manifest.json')),files};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const {manifest,files}=await readChromePackage();
  checkChromeSecurity(manifest,files);
  console.log('Chrome extension security: MV3 CSP, packaged code/styles and execution checks OK.');
}
