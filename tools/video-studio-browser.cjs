/* 自有候选站的浏览器验收；收费按钮最多点击一次，其他检查只读。 */
const {chromium}=require('C:/Users/chyyds/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve('.codex/video-studio'),base='http://127.0.0.1:28690';
const auth=JSON.parse(fs.readFileSync(path.join(root,'browser-auth.private.json'),'utf8'));
const phase=process.argv[2]||'prepare';
const report={phase,checks:[],page_errors:[],generation_requests:0};
let browser;
async function context(identity,viewport={width:1536,height:1000}) {
 const c=await browser.newContext({viewport});
 await c.addInitScript(a=>{localStorage.setItem('auth_token',a.access_token);localStorage.setItem('auth_user',JSON.stringify(a.user));localStorage.setItem('sub2api_locale','zh');localStorage.setItem('theme','dark');localStorage.setItem(`onboarding_tour_${a.user.id}_${a.user.role}_v4_interactive`,'true')},identity);
 await c.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==base)return r.abort();return r.continue()});
 return c;
}
async function screenshot(page,name){await page.screenshot({path:path.join(root,name+'.png'),fullPage:false});report.checks.push(name)}
async function goto(page,url){await page.goto(base+url,{waitUntil:'domcontentloaded'});await page.keyboard.press('Escape')}
async function request(page,url,method='GET',body){return page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:{Authorization:'Bearer '+localStorage.getItem('auth_token'),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}},{url,method,body})}
(async()=>{
 browser=await chromium.launch({headless:true,channel:'chrome'});
 const c=await context(auth.user),page=await c.newPage();page.setDefaultTimeout(180000);page.on('pageerror',e=>report.page_errors.push(e.message));
 page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/v1/videos')report.generation_requests++});
 if(phase==='prepare') {
  await goto(page,'/keys?action=create&vendor=video');
  await page.locator('[data-tour="key-form-name"]').waitFor();
  assert.equal(await page.locator('input[name="key-provider"][value="video"]').isChecked(),true);
  await page.locator('[data-tour="key-form-name"]').fill('视频创作验收 Key');
  await screenshot(page,'01-video-key-create');
  const response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/v1/keys');
  await page.locator('button[type="submit"][form="key-form"]').click();
  const created=await (await response).json();assert.equal(created.code,0);
  fs.writeFileSync(path.join(root,'key.private.json'),JSON.stringify(created.data));
 }
 await goto(page,'/ai-creation/video');
 await page.locator('.video-fixed').filter({hasText:'oo-sd25-1080p'}).waitFor();
 await page.locator('.video-price').waitFor();
 assert.equal(await page.locator('.video-ratios button').count(),5);
 assert.equal(await page.locator('#video-duration').inputValue(),'30');
 assert.equal(await page.locator('.video-compose').getByText('1080P',{exact:true}).count(),2);
 await page.locator('#video-image-files').setInputFiles(path.join(root,'reference-lake.png'));
 await page.locator('#video-audio-files').setInputFiles(path.join(root,'reference-ambient.wav'));
 await page.locator('.video-media-item').nth(1).waitFor();
 await page.locator('#video-prompt').fill('以@图片1的湖泊、帆船和暖色晨光为参考，生成自然写实的电影画面。一艘小帆船轻轻驶过平静湖面，远山薄雾缓缓流动，水面倒影细腻，镜头从近处缓慢拉远，保持横向构图和稳定运镜。参考音频的舒缓氛围，画面宁静，不出现文字和水印。');
 assert.equal(await page.locator('.video-generate').isEnabled(),true);
 await screenshot(page,'02-video-ready');
 if(phase==='submit') {
  const marker=path.join(root,'paid-attempt.json');assert.equal(fs.existsSync(marker),false,'已记录过真实提交，禁止自动重复');
  fs.writeFileSync(marker,JSON.stringify({started_at:new Date().toISOString(),maximum_paid_generations:1}));
  const response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/v1/videos');
  await page.locator('.video-generate').click();
  const res=await response;const task=await res.json();assert.equal(res.status(),202,JSON.stringify(task));
  fs.writeFileSync(path.join(root,'real-task.json'),JSON.stringify(task,null,2));
  await page.locator('.video-history-item').first().waitFor();
  await screenshot(page,'03-video-submitted');
  assert.equal(report.generation_requests,1);
 } else {
  assert.equal(report.generation_requests,0);
  for(const [width,height]of [[390,844],[768,1024],[1280,800],[1920,1080]]){
   await page.setViewportSize({width,height});await page.waitForTimeout(150);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'页面横向溢出 '+width);
   assert.equal(await page.locator('.video-history').isVisible(),true,'生成记录必须在各尺寸可访问');
   await screenshot(page,'video-'+width);
  }
 }
 assert.deepEqual(report.page_errors,[]);
 fs.writeFileSync(path.join(root,'browser-'+phase+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(async()=>{if(browser)await browser.close()});
