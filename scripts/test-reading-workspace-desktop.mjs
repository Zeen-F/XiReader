import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { _electron as electron, expect } from '@playwright/test';
import { readingWorkspaceWorkflow } from '../tests/reading-workspace.browser.mjs';
import { clearInheritedTestStorage } from './test-isolated.mjs';
import { desktopTestTarget, temporaryTestDirectory, testEvidenceDirectory, removeTestDirectory, closeTestApplication } from './desktop-test-support.mjs';

clearInheritedTestStorage();
const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: { packaged: { type: 'string' } } });
const target = desktopTestTarget(values.packaged);
const temporary = await temporaryTestDirectory('paperdesk-workspace-desktop-');
const userData = path.join(temporary, 'profile');
const evidence = testEvidenceDirectory(root, temporary);
const env = { ...process.env, PAPERDESK_DESKTOP_USER_DATA: userData, PAPERDESK_DESKTOP_PORT: '0' };
delete env.ELECTRON_RUN_AS_NODE;
let application;
try {
  await mkdir(evidence, { recursive: true });
  application = await electron.launch({ executablePath: target.executablePath, args: values.packaged ? [] : [root], cwd: temporary, env, chromiumSandbox: true, timeout: 60_000 });
  const main = await application.firstWindow();
  await expect(main.locator('.app-shell')).toBeVisible();
  const base = new URL(main.url()).origin;
  const documents = await fetch(`${base}/api/documents`).then(response => response.json());
  assert.equal(documents.documents.length, 0, 'Native workflow must use a new synthetic library');
  assert.equal(await main.title(), 'XiReader · 本地文献工作台');
  // Electron creates BrowserWindows rather than using Target.createTarget.
  // Every test window shares only this isolated profile and the packaged server.
  const context = {
    async newPage() {
      const pending = application.waitForEvent('window');
      await application.evaluate(({ BrowserWindow }) => {
        const source = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
        const testWindow = new BrowserWindow({ width: 1440, height: 1000, title: 'XiReader · synthetic acceptance', webPreferences: { preload: source.preload, sandbox: true, contextIsolation: true, nodeIntegration: false } });
        void testWindow.loadURL('about:blank');
      });
      const page = await pending;
      page.setDefaultTimeout(15_000);
      return page;
    },
  };
  await readingWorkspaceWorkflow({ context, base, onPreview: (page, label) => page.screenshot({ path: path.join(evidence, `native-${label}.png`), fullPage: true, animations: 'disabled' }) });
  const security = await application.evaluate(({ app, BrowserWindow }) => ({ appPath: app.getAppPath(), electron: process.versions.electron, sandbox: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().sandbox }));
  assert.equal(security.sandbox, true);
  if (target.appPath) assert.equal(security.appPath, target.appPath);
  console.log('PASS: native XiReader packaged reading workflow', JSON.stringify(security));
} finally {
  await closeTestApplication(application, userData);
  await removeTestDirectory(temporary, 'paperdesk-workspace-desktop-');
}
