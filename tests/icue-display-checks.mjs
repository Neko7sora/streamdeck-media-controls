import assert from 'node:assert/strict';

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
