import {test,expect} from '@playwright/test';
for(const mobile of [false,true])test(`create synchronized group and preserve local choice (${mobile?'mobile':'desktop'})`,async({page,context})=>{
  await context.addCookies([{name:'frigg_sid',value:'synthetic-test-only',url:'http://127.0.0.1:4310'}]);
  await page.route('**/api/carddav-groups/capabilities?*',r=>r.fulfill({json:{formats:['vcard4','apple']}}));
  let saved=false;
  await page.route('**/api/carddav-groups',r=>{
    expect(r.request().postDataJSON()).toEqual({name:'Familie',addressbook_id:'test-book',format:'vcard4'});saved=true;
    return r.fulfill({status:201,json:{id:'dav:test',kind:'carddav',name:'Familie',member_uids:[],format:'vcard4',etag:'"new"',addressbook_id:'test-book'}});
  });
  await page.goto('/');await page.getByTitle('Neue Gruppe',{exact:true}).click();
  if(mobile)await page.setViewportSize({width:390,height:844});
  await expect(page.getByLabel('Speicherort')).toHaveValue('');
  await page.getByLabel('Speicherort').selectOption('test-book');
  await expect(page.getByLabel('Gruppenformat')).toHaveValue('vcard4');
  await page.getByPlaceholder('z.B. Familie, Kollegen, VIPs …').fill('Familie');
  await page.screenshot({path:`test-results/group-${mobile?'mobile':'desktop'}.png`,fullPage:true});
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Neue Gruppe',exact:true})).not.toBeVisible();
  expect(saved).toBe(true);
});
test('unsupported group server disables creation without converting local groups',async({page,context})=>{
  await context.addCookies([{name:'frigg_sid',value:'synthetic-test-only',url:'http://127.0.0.1:4310'}]);
  await page.route('**/api/carddav-groups/capabilities?*',r=>r.fulfill({json:{formats:[]}}));
  await page.goto('/');await page.getByTitle('Neue Gruppe',{exact:true}).click();
  await page.getByLabel('Speicherort').selectOption('test-book');
  await expect(page.getByRole('button',{name:'Speichern',exact:true})).toBeDisabled();
  await page.getByLabel('Speicherort').selectOption('');
  await expect(page.getByRole('button',{name:'Speichern',exact:true})).toBeEnabled();
});
