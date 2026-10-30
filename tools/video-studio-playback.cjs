/* 只验证原任务的页面播放和下载，不创建任何视频。 */
const {chromium}=require('C:/Users/chyyds/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve('.codex/video-studio'),base='http://127.0.0.1:28690';
const auth=JSON.parse(fs.readFileSync(path.join(root,'browser-auth.private.json'),'utf8')).user;
let browser;
(async()=>{
 browser=await chromium.launch({headless:true,channel:'chrome'});
 const context=await browser.newContext({viewport:{width:1536,height:1000},acceptDownloads:true});
 await context.addInitScript(a=>{localStorage.setItem('auth_token',a.access_token);localStorage.setItem('auth_user',JSON.stringify(a.user));localStorage.setItem('sub2api_locale','zh');localStorage.setItem('theme','dark');localStorage.setItem(`onboarding_tour_${a.user.id}_${a.user.role}_v4_interactive`,'true');window.showSaveFilePicker=undefined},auth);
 let posts=0;const errors=[];
 const page=await context.newPage();page.setDefaultTimeout(180000);page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/v1/videos')posts++});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/ai-creation/video',{waitUntil:'domcontentloaded'});
 await page.locator('.video-price').waitFor();await page.locator('.video-history-item').first().click();
 await page.locator('.video-result video').waitFor();
 await page.waitForFunction(()=>{const v=document.querySelector('.video-result video');return v&&(v.readyState>=1||v.error)},{},{timeout:180000});
 const metadata=await page.locator('video').evaluate(v=>({width:v.videoWidth,height:v.videoHeight,duration:v.duration,error:v.error?.message||null}));
 assert.equal(metadata.error,null);assert.equal(metadata.width,1920);assert.equal(metadata.height,1080);assert.ok(metadata.duration>=29);
 await page.locator('video').evaluate(async v=>{v.muted=true;await v.play()});await page.waitForTimeout(800);
 const playing=await page.locator('video').evaluate(v=>v.currentTime>0);assert.equal(playing,true);
 await page.locator('video').evaluate(v=>v.pause());await page.screenshot({path:path.join(root,'04-video-playback.png'),fullPage:false});
 const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'下载原视频',exact:true}).click();const download=await downloadEvent;
 const file=path.join(root,'real-video.mp4');await download.saveAs(file);
 const bytes=fs.readFileSync(file),sha=crypto.createHash('sha256').update(bytes).digest('hex');
 const validation=JSON.parse(fs.readFileSync(path.join(root,'real-validation.json'),'utf8'));assert.equal(sha,validation.sha256);
 assert.equal(posts,0);assert.deepEqual(errors,[]);
 const result={...metadata,played:true,download_bytes:bytes.length,sha256:sha,generation_requests:posts,page_errors:errors};
 fs.writeFileSync(path.join(root,'browser-playback.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(async()=>{if(browser)await browser.close()});
