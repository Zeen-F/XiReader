import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {_electron as electron,expect} from '@playwright/test';
import {diagnosticCodexCli} from './codex-test-diagnostic.mjs';
import {desktopTestTarget} from './desktop-test-support.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),{values}=parseArgs({options:{packaged:{type:'string'},real:{type:'boolean',default:false}}});
if(!values.packaged||!values.real)throw new Error('Provide --packaged <candidate> --real to explicitly authorize the synthetic native model test.');
const target=desktopTestTarget(values.packaged),evidence=path.join(root,'.local/codex-sidebar');await mkdir(evidence,{recursive:true});
const profile=await mkdtemp(path.join(evidence,'native-fixture-')),env={...process.env,PAPERDESK_DESKTOP_USER_DATA:profile,PAPERDESK_DESKTOP_PORT:'0'};delete env.ELECTRON_RUN_AS_NODE;delete env.PAPERDESK_VAULT_DIR;delete env.PAPERDESK_DATA_DIR;
env.PAPERDESK_CODEX_CLI=await diagnosticCodexCli(profile,path.join(evidence,'native-lifecycle-protocol.jsonl'));
await writeFile(path.join(profile,'appearance.json'),JSON.stringify({visual:'shanlan'}));let application;const errors=[];let info;
async function quit(){if(!application)return;const current=application,child=current.process();const exited=new Promise((resolve,reject)=>{if(child.exitCode!==null)return resolve();const timer=setTimeout(()=>reject(new Error('Owned synthetic application did not quit normally; preserved profile, no force kill.')),15000);child.once('close',()=>{clearTimeout(timer);resolve();});});await current.evaluate(({app})=>app.quit());await exited;application=null;}
try{
 application=await electron.launch({executablePath:target.executablePath,args:[],cwd:profile,env,chromiumSandbox:true,timeout:60000});
 let page=await application.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForLoadState('domcontentloaded');await expect(page.locator('.app-shell')).toBeVisible();
 info=await application.evaluate(({app,BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.setTitle('XiReader — SYNTHETIC CODEX ACCEPTANCE');return{version:app.getVersion(),appPath:app.getAppPath(),userData:app.getPath('userData'),electron:process.versions.electron,node:process.versions.node};});
 assert.equal(info.userData,profile);assert.equal(info.appPath,target.appPath);
 await page.getByLabel('选择 PDF 文件',{exact:true}).setInputFiles(path.join(root,'public/examples/reading-demo.pdf'));await expect(page.locator('.pdf-paper[data-page="1"] .textLayer')).toBeVisible({timeout:30000});
 await page.getByRole('tab',{name:'Codex',exact:true}).click();await page.getByRole('button',{name:'开始 Codex 对话',exact:true}).click();
 await page.getByRole('button',{name:/^(连接 Codex|重新检查连接)$/}).click();await expect(page.getByLabel('Codex 模型',{exact:true})).toBeVisible({timeout:60000});if(await page.getByLabel('Codex 推理强度',{exact:true}).locator('option[value="low"]').count())await page.getByLabel('Codex 推理强度',{exact:true}).selectOption('low');
 await page.getByLabel('发给 Codex 的问题').fill('Synthetic native acceptance test using the original demo only. What is the heading of section 1 on PDF page 1? Answer in one short sentence, and do not use tools.');await page.getByRole('button',{name:'核对上下文',exact:true}).click();await expect(page.locator('.codex-snapshot')).toContainText('Set one question');await page.getByRole('button',{name:'发送给 Codex',exact:true}).click();
 await expect(page.locator('.codex-answer')).toContainText('已完成',{timeout:120000});const answer=await page.locator('.codex-answer').innerText();assert.match(answer,/Set one question|设定一个问题|提出一个问题|设置一个问题/i);
 await page.reload();await page.getByRole('tab',{name:'Codex',exact:true}).click();await expect(page.locator('.codex-answer')).toContainText('已完成');await expect(page.locator('.codex-answer')).toContainText(/Set one question|设定一个问题|提出一个问题|设置一个问题/i);
 await page.getByLabel('发给 Codex 的问题').fill('Synthetic cancellation acceptance: enumerate 500 fictional moons, one per line; do not use tools.');await page.getByLabel('附带本次阅读上下文').uncheck();await page.getByRole('button',{name:'核对上下文',exact:true}).click();await page.getByRole('button',{name:'发送给 Codex',exact:true}).click();await expect(page.getByRole('button',{name:'停止回答',exact:true})).toBeVisible({timeout:120000});await page.getByRole('button',{name:'停止回答',exact:true}).click();await expect(page.locator('.codex-answer').last()).toContainText('已停止',{timeout:30000});
 await page.getByLabel('发给 Codex 的问题').fill('Synthetic active-close acceptance: enumerate 500 fictional stars, one per line; do not use tools.');await page.getByRole('button',{name:'核对上下文',exact:true}).click();await page.getByRole('button',{name:'发送给 Codex',exact:true}).click();await expect(page.getByRole('button',{name:'停止回答',exact:true})).toBeVisible({timeout:120000});await expect(page.getByRole('button',{name:'停止回答',exact:true})).toBeEnabled();
 await quit();application=await electron.launch({executablePath:target.executablePath,args:[],cwd:profile,env,chromiumSandbox:true,timeout:60000});page=await application.firstWindow();page.on('pageerror',e=>errors.push(e.message));await expect(page.locator('.app-shell')).toBeVisible();await page.getByRole('tab',{name:'Codex',exact:true}).click();
 // sessionStorage belongs to the window: explicitly select the persisted conversation after a full process restart.
 await page.getByLabel('选择 Codex 会话').selectOption({index:1});await expect(page.locator('.codex-answer').first()).toContainText('已完成');await expect(page.locator('.codex-answer').nth(1)).toContainText('已停止');await expect(page.locator('.codex-chat-history li')).toHaveCount(3);
 const recover=page.getByRole('button',{name:'核对原会话结果',exact:true});if(await recover.isVisible())await recover.click();await expect(page.locator('.codex-answer').last()).toContainText(/已停止|已完成/,{timeout:120000});
 await page.getByRole('button',{name:/^(连接 Codex|重新检查连接)$/}).click();await expect(page.getByLabel('Codex 模型',{exact:true})).toBeVisible({timeout:60000});
 await page.getByLabel('发给 Codex 的问题').fill('Continue our same synthetic discussion. What section heading did you identify earlier? Reply with that heading only, and do not use tools.');await page.getByLabel('附带本次阅读上下文').uncheck();await page.getByRole('button',{name:'核对上下文',exact:true}).click();await page.getByRole('button',{name:'发送给 Codex',exact:true}).click();await expect(page.locator('.codex-chat-history li')).toHaveCount(4,{timeout:60000});await expect(page.locator('.codex-answer').last()).toContainText('已完成',{timeout:120000});await expect(page.locator('.codex-answer').last()).toContainText(/Set one question|设定一个问题|提出一个问题|设置一个问题/i);
 await expect(page.locator('.pdf-paper[data-page="1"] .textLayer')).toBeVisible();await page.screenshot({path:path.join(evidence,'codex-sidebar-native.png'),fullPage:true});assert.deepEqual(errors,[]);
 await writeFile(path.join(evidence,'native-result.json'),JSON.stringify({passed:true,syntheticModel:true,modelRequests:4,stopConfirmed:true,activeCloseRecovered:true,processRestartResumed:true,info,answer,errors},null,2));
 console.log(JSON.stringify({passed:true,packagedApp:info.appPath,version:info.version,electron:info.electron,realSyntheticAnswer:answer,reloadPreserved:true,stopConfirmed:true,activeCloseRecovered:true,processRestartResumed:true}));
}finally{
 await quit();
 await rm(profile,{recursive:true,force:true});
}
