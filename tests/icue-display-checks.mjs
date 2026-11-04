import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

// Exercise real DOM visibility and geometry; provider-owned hidden attributes must survive.
export async function checkDisplayPreferences(page, {bridge, sizes}) {
  const items = {
    showArtwork:'#cover', showTitle:'#songName', showArtist:'#artist', showAlbum:'#album',
    showStatus:'#playbackStatus', showAppIcon:'#appIcon', showMediaTarget:'#mediaTargetField',
    showAudioTarget:'#audioTargetField', showSeekBar:'#seekRange', showPosition:'#positionText',
    showVolumeSlider:'#volumeSlider', showVolumeValue:'#volumeText', showMute:'#muteButton',
    showPrevious:'#previousButton', showPlayPause:'#playPauseButton', showNext:'#nextButton',
    showRewind:'#rewindButton', showStop:'#stopButton', showForward:'#forwardButton',
    showConnectionInfo:'#bridgeNotice', showBrand:'#brandLabel',
  };
  const settings = Object.keys(items).concat('showDecoration');
  const update = values => page.evaluate(values => {
    Object.assign(window, values); window.icueEvents.onDataUpdated();
  }, values);
  await page.setViewportSize({width:1688, height:696});
  for (const [name, selector] of Object.entries(items)) {
    const visibleBefore = await page.locator(selector).isVisible();
    await update({[name]:false});
    assert.equal(await page.locator(selector).isVisible(), false, `${name}: hidden`);
    // Multiple host updates must not reveal a disabled item.
    await update({});
    assert.equal(await page.locator(selector).isVisible(), false, `${name}: stays hidden`);
    if (name === 'showStatus') assert.equal(await page.locator('#statusDot').isVisible(), false);
    if (name === 'showSeekBar') assert.equal(await page.locator('#seekLabel').isVisible(), false);
    await update({[name]:true});
    assert.equal(await page.locator(selector).isVisible(), visibleBefore, `${name}: restored`);
  }
  const fonts = {titleSize:'#songName', artistSize:'#artist', albumSize:'#album', labelSize:'#statusText'};
  for (const [name, selector] of Object.entries(fonts)) {
    const font = () => page.locator(selector).evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    await update({[name]:100}); const baseline = await font();
    await update({[name]:150}); assert.ok(Math.abs(await font() / baseline - 1.5) < .01, name);
    await update({[name]:75}); assert.ok(Math.abs(await font() / baseline - .75) < .01, name);
    await update({[name]:100});
  }
  await update(Object.fromEntries(Object.keys(fonts).map(key => [key,150])));
  for (const [width,height] of sizes) {
    await page.setViewportSize({width,height});
    await page.locator('#deck').evaluate(node => {node.scrollTop=0;});
    if ((width === 840 && height === 344) || (width === 696 && height === 840)) {
      await page.screenshot({path:fileURLToPath(new URL(`.generated/icue-max-${bridge ? 'bridge' : 'standard'}-${width}x${height}.png`,import.meta.url))});
    }
    const layoutSelectors = '#deck, .content, #cover, .metadata, .bridge-panel, .target-row, .seek-row, .audio-row, .bottomline';
    const layout = await page.locator(layoutSelectors).evaluateAll(nodes => nodes.map(node => ({id:node.id || node.className,
      rect:node.getBoundingClientRect().toJSON(), scrollHeight:node.scrollHeight, clientHeight:node.clientHeight})));
    assert.equal(await page.locator('#deck').evaluate(node => node.scrollHeight <= node.clientHeight + 1), true,
      `${width}x${height}: all maximum-size text and controls must fit without scrolling: ${JSON.stringify(layout)}`);
    const collisions = await page.locator('.topline, .metadata, .bridge-panel, .bottomline').evaluateAll(nodes => {
      const visible = nodes.filter(node => node.getClientRects().length);
      const errors = [];
      for (const node of visible) {
        const box = node.getBoundingClientRect();
        for (const child of node.children) {
          if (!child.getClientRects().length) continue;
          const childBox = child.getBoundingClientRect();
          if (childBox.top < box.top - 1 || childBox.bottom > box.bottom + 1) {
            errors.push(`${child.id || child.className} overflows ${node.className}`);
          }
        }
      }
      for (let i=1;i<visible.length;i++) {
        if (visible[i-1].getBoundingClientRect().bottom > visible[i].getBoundingClientRect().top + 1) {
          errors.push(`${visible[i-1].className} overlaps ${visible[i].className}`);
        }
      }
      return errors;
    });
    assert.deepEqual(collisions, [], `${width}x${height}: largest text must not overlap`);
    assert.equal(await page.locator('#deck').evaluate(node => node.scrollWidth <= node.clientWidth + 1), true,
      `${width}x${height}: large text must not need horizontal scrolling`);
    for (const selector of Object.values(items)) {
      const node = page.locator(selector);
      if (!await node.isVisible()) continue;
      await node.scrollIntoViewIfNeeded();
      const rect = await node.boundingBox();
      assert.ok(rect.x >= -.5 && rect.y >= -.5 && rect.x + rect.width <= width + .5 && rect.y + rect.height <= height + .5,
        `${width}x${height}: largest text unreachable ${selector}: ${JSON.stringify(rect)}`);
    }
    if (bridge) {
      const touchTargets = await page.locator('.control, .extra-controls button, .bridge-panel input, .bridge-panel select, .target-picker, #muteButton').evaluateAll(nodes =>
        nodes.filter(node => node.getClientRects().length).map(node => ({id:node.id, rect:node.getBoundingClientRect().toJSON()})));
      for (const {id, rect} of touchTargets) {
        assert.ok(rect.width >= 47.5 && rect.height >= 47.5, `${width}x${height}: maximum text retains touch target ${id}: ${JSON.stringify(rect)}`);
      }
      assert.deepEqual(await page.locator('.extra-controls button, #muteButton').evaluateAll(nodes => nodes.filter(node =>
        node.getClientRects().length && node.scrollWidth > node.clientWidth + 1).map(node => node.id)), [], 'button labels must not overflow');
    }
    for (const scale of [.5,.25]) {
      await page.evaluate(() => {window.iCUE.isPreview=true;window.icueEvents.onDataUpdated();});
      await page.setViewportSize({width:width*scale,height:height*scale});
      assert.equal(await page.locator('#deck').evaluate(node => node.scrollHeight <= node.clientHeight + 1 && node.scrollWidth <= node.clientWidth + 1), true,
        `${width}x${height} at ${scale}: maximum text fits preview`);
      const preview = await page.locator(layoutSelectors).evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()));
      for (let i=0;i<layout.length;i++) for (const key of ['x','y','width','height']) {
        assert.ok(Math.abs(preview[i][key] / scale - layout[i].rect[key]) < 2,
          `${width}x${height} at ${scale}: maximum text preview proportions ${layout[i].id} ${key}`);
      }
    }
    await page.evaluate(() => {window.iCUE.isPreview=false;window.icueEvents.onDataUpdated();});
    await page.setViewportSize({width,height});
  }
  await page.locator('#deck').evaluate(node => {node.scrollTop=0;});
  await update(Object.fromEntries(settings.map(key => [key,false])));
  for (const selector of ['.content','.metadata','.topline','.bottomline','.bridge-panel']) {
    assert.equal(await page.locator(selector).isVisible(), false, `${selector}: empty groups collapse`);
  }
  await update({showTitle:true,showArtwork:true});
  for (const [width,height] of sizes) {
    await page.setViewportSize({width,height});
    assert.equal(await page.locator('#songName').isVisible(), true);
    assert.equal(await page.locator('#cover').isVisible(), true);
    assert.equal(await page.locator('.bridge-panel').isVisible(), false);
  }
  await update({showTitle:false});
  assert.equal(await page.locator('.content').isVisible(), false, 'artwork-only hides content column');
  for (const [width,height] of sizes) {
    await page.setViewportSize({width,height});
    const cover = await page.locator('#cover').boundingBox();
    assert.ok(cover.width > Math.min(width,height) * .8, `${width}x${height}: artwork-only uses freed space`);
    assert.ok(cover.x >= -.5 && cover.y >= -.5 && cover.x + cover.width <= width + .5 && cover.y + cover.height <= height + .5,
      `${width}x${height}: artwork-only fits display`);
  }
  await update(Object.fromEntries(settings.map(key => [key,true])));
  await update(Object.fromEntries(Object.keys(fonts).map(key => [key,100])));
  assert.equal(await page.locator('#songName').isVisible(), true);
  assert.equal(await page.locator('#bridgePanel').isVisible(), bridge);
  if (bridge) {
    for (const [width,height] of sizes) {
      await page.setViewportSize({width,height});
      await update(Object.fromEntries(Object.keys(fonts).map(key => [key,100])));
      const controlSelector = '.control, .extra-controls button, .bridge-panel input, .bridge-panel select, .target-picker, #muteButton';
      const normalHeights = await page.locator(controlSelector).evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.id,node.getBoundingClientRect().height])));
      await update(Object.fromEntries(Object.keys(fonts).map(key => [key,75])));
      assert.equal(await page.locator('#deck').evaluate(node => node.scrollHeight <= node.clientHeight + 1 && node.scrollWidth <= node.clientWidth + 1), true,
        `${width}x${height}: smallest text fits device`);
      const controls = await page.locator(controlSelector).evaluateAll(nodes =>
        nodes.filter(node => node.getClientRects().length).map(node => ({id:node.id, rect:node.getBoundingClientRect().toJSON()})));
      for (const {id,rect} of controls) {
        assert.ok(rect.width >= 24 && rect.height >= 24, `${width}x${height}: compact target ${id}`);
        assert.ok(rect.height < normalHeights[id] * .7, `${width}x${height}: compact controls must shrink with text: ${id}`);
      }
      assert.equal(await page.locator('.content').evaluate(node => {
        const gap = parseFloat(getComputedStyle(node).rowGap);
        const rows = [...node.children].filter(child => child.getClientRects().length);
        return rows.slice(1).every((row,i) => row.getBoundingClientRect().top - rows[i].getBoundingClientRect().bottom <= gap + 1);
      }), true, `${width}x${height}: compact content must not distribute empty vertical space`);
      if ((width === 840 && height === 344) || (width === 2536 && height === 696)) {
        await page.screenshot({path:fileURLToPath(new URL(`.generated/icue-min-bridge-${width}x${height}.png`,import.meta.url))});
      }
      const device = await page.locator('#cover, .content, #muteButton').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()));
      for (const scale of [.5,.25]) {
        await page.evaluate(() => {window.iCUE.isPreview=true;window.icueEvents.onDataUpdated();});
        await page.setViewportSize({width:width*scale,height:height*scale});
        const preview = await page.locator('#cover, .content, #muteButton').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()));
        for (let i=0;i<device.length;i++) for (const key of ['x','y','width','height']) {
          assert.ok(Math.abs(preview[i][key] / scale - device[i][key]) < 2, `${width}x${height} at ${scale}: compact preview proportions`);
        }
      }
      await page.evaluate(() => {window.iCUE.isPreview=false;window.icueEvents.onDataUpdated();});
      await page.setViewportSize({width,height});
    }
    await update(Object.fromEntries(Object.keys(fonts).map(key => [key,100])));
    await update({showMediaTarget:false});
    assert.equal(await page.locator('#audioTargetField').isVisible(), true);
    assert.equal(await page.locator('#audioTargetField').evaluate(node => Math.abs(node.getBoundingClientRect().width - node.parentElement.getBoundingClientRect().width) < 1), true);
    await update({showAudioTarget:false});
    assert.equal(await page.locator('.target-row').isVisible(), false);
    await update({showMediaTarget:true,showAudioTarget:true});
    await update({showSeekBar:false});
    assert.equal(await page.locator('#positionText').isVisible(), true);
    await update({showPosition:false});
    assert.equal(await page.locator('.seek-row').isVisible(), false);
    await update({showSeekBar:true,showPosition:true});
    await update({showVolumeSlider:false,showVolumeValue:false});
    assert.equal(await page.locator('#muteButton').isVisible(), true);
    await update({showMute:false});
    assert.equal(await page.locator('.audio-row').isVisible(), false);
    await update({showVolumeSlider:true,showVolumeValue:true,showMute:true});
  } else {
    const standardItems = ['showTitle','showArtist','showAlbum','showStatus','showAppIcon','showPrevious','showPlayPause','showNext','showBrand'];
    await update(Object.fromEntries(standardItems.map(key => [key,false])));
    assert.equal(await page.locator('.content').isVisible(), false, 'bridge-only options cannot reserve standard layout space');
    await update(Object.fromEntries(standardItems.map(key => [key,true])));
  }
  console.log(`OK iCUE ${bridge ? 'bridge' : 'standard'} individual visibility, empty groups, text size limits and all Edge slots`);
}
