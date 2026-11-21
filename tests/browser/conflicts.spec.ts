import { test, expect } from '@playwright/test';

const baseline = { uid:'synthetic', addressbook_id:'test-book', etag:'"base"', fn:'Anne Testperson', given_name:'Anne', family_name:'Testperson', org:'Testfirma', title:null, birthday:'--0229', note:'Ursprünglich', has_photo:false, photo_data_uri:null, phones:[], emails:[], addresses:[], created_at:'2026-01-01T00:00:00Z', updated_at:'2026-01-01T00:00:00Z' };

for (const mobile of [false,true]) {
  test(`conflict decisions and repeated conflict (${mobile ? 'mobile dialog' : 'desktop'})`, async ({ page, context }) => {
    await context.addCookies([{ name:'frigg_sid', value:'synthetic-test-only', url:'http://127.0.0.1:4310' }]);
    await page.goto('/');
    await page.getByRole('button', { name:/Anne Testperson/ }).click();
    await page.getByRole('button', { name:'Bearbeiten', exact:true }).click();
    await expect(page.getByPlaceholder('Notiz ...')).toHaveValue('Ursprünglich');
    if (mobile) await page.setViewportSize({ width:390, height:844 });
    await page.getByPlaceholder('Notiz ...').fill('Meine Notiz');
    let requests = 0;
    await page.route('**/api/contacts/synthetic', async route => {
      if (route.request().method() !== 'PUT') return route.continue();
      requests++;
      const body = route.request().postDataJSON();
      expect(body.note).toBe('Meine Notiz');
      expect(body.org).toBeUndefined();
      if (requests < 3) return route.fulfill({ status:409, json:{ error:'conflict', server:{ ...baseline, etag:`"server-${requests}"`, note:`Servernotiz ${requests}`, org:'Neue Firma' } } });
      expect(route.request().headers()['if-match']).toBe('"server-2"');
      return route.fulfill({ json:{ ...baseline, ...body, org:'Neue Firma', etag:'"saved"' } });
    });
    await page.getByRole('button', { name:'Speichern', exact:true }).click();
    await expect(page.getByRole('region', { name:'Änderungen vergleichen' })).toBeVisible();
    await expect(page.getByText('Servernotiz 1', { exact:true })).toBeVisible();
    await expect(page.getByRole('button', { name:'Auswahl speichern' })).toBeDisabled();
    await page.getByLabel('Meine Änderung verwenden', { exact:true }).check();
    await page.screenshot({ path:`test-results/conflict-${mobile?'mobile':'desktop'}.png`, fullPage:true });
    const width = await page.locator('.modal-panel').evaluate(e => e.getBoundingClientRect().width);
    expect(width).toBeLessThanOrEqual(mobile ? 390 : 1280);
    await page.getByRole('button', { name:'Auswahl speichern' }).click();
    await expect(page.getByText('Servernotiz 2', { exact:true })).toBeVisible();
    await expect(page.getByRole('button', { name:'Auswahl speichern' })).toBeDisabled();
    await page.getByLabel('Meine Änderung verwenden', { exact:true }).check();
    await page.getByRole('button', { name:'Auswahl speichern' }).click();
    await expect(page.getByRole('heading', { name:'Kontakt bearbeiten' })).not.toBeVisible();
    expect(requests).toBe(3);
  });
}

test('cancel conflict preserves form and offline save keeps user input', async ({ page, context }) => {
  await context.addCookies([{ name:'frigg_sid', value:'synthetic-test-only', url:'http://127.0.0.1:4310' }]);
  await page.goto('/');
  await page.getByRole('button', { name:/Anne Testperson/ }).click();
  await page.getByRole('button', { name:'Bearbeiten', exact:true }).click();
  await expect(page.getByPlaceholder('Notiz ...')).toHaveValue('Ursprünglich');
  await page.getByPlaceholder('Notiz ...').fill('Nicht verlieren');
  await page.route('**/api/contacts/synthetic', route => route.fulfill({ status:409, json:{ error:'conflict', server:{ ...baseline, note:'Server', etag:'"new"' } } }));
  await page.getByRole('button', { name:'Speichern', exact:true }).click();
  await page.getByRole('button', { name:'Zurück zur Bearbeitung' }).click();
  await expect(page.getByPlaceholder('Notiz ...')).toHaveValue('Nicht verlieren');
  await page.unroute('**/api/contacts/synthetic');
  await page.route('**/api/contacts/synthetic', route => route.abort('connectionfailed'));
  await page.getByRole('button', { name:'Speichern', exact:true }).click();
  await expect(page.getByText('Der Server ist nicht erreichbar. Deine Eingaben bleiben erhalten.')).toBeVisible();
  await expect(page.getByPlaceholder('Notiz ...')).toHaveValue('Nicht verlieren');
});
