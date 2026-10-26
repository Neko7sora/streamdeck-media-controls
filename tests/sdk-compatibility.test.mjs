import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JsonRpcRequest,JsonRpcResponse} from '@elgato/utils/rpc';
import {Option,OptionGroup} from '@elgato/utils';

// Exercise the real SDK schemas: plugin-routing tests intentionally mock the
// SDK connection and cannot detect an incompatible transitive Zod override.
test('patched Zod preserves SDK inspector RPC requests, replies and validation',()=>{
  for(const params of [{mediaTarget:'auto',scrollText:true},['target',2]]) {
    const request={jsonrpc:'2.0',method:'settings',params,id:'request-1'};
    assert.deepEqual(JsonRpcRequest.parse(request),request);
  }
  for(const response of [{jsonrpc:'2.0',result:{ok:true},id:'request-1'},
    {jsonrpc:'2.0',error:{code:-32601,message:'Not found'},id:'request-1'}]) {
    assert.deepEqual(JsonRpcResponse.parse(response),response);
  }
  assert.equal(JsonRpcRequest.safeParse({jsonrpc:'2.0',method:42}).success,false);
  assert.equal(JsonRpcResponse.safeParse({jsonrpc:'2.0',result:true,id:42}).success,false);
});

test('patched Zod preserves nested SDK option groups and rejects invalid targets',()=>{
  const option={type:'option',label:'PC全体',value:'master'};
  const group={type:'option-group',label:'Targets',options:[option,{type:'option-group',label:'Apps',options:[]}]};
  assert.deepEqual(Option.parse(option),option);
  assert.deepEqual(OptionGroup.parse(group),group);
  assert.equal(Option.safeParse({...option,value:{target:'master'}}).success,false);
  assert.equal(OptionGroup.safeParse({...group,options:[{type:'unknown'}]}).success,false);
});
