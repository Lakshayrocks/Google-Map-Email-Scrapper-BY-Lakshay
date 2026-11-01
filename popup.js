
const $ = id => document.getElementById(id);
const getLeads = () => new Promise(resolve => chrome.storage.local.get({leads: []}, x => resolve(x.leads)));
const setLeads = leads => new Promise(resolve => chrome.storage.local.set({leads}, resolve));
const status = msg => $("status").textContent = msg;

function getUniqueValidEmails(leads) {
  const found = new Set();
  // Find email-shaped tokens anywhere in the field. This counts
  // "a@example.com; b@example.com" as TWO addresses, not one row.
  const emailPattern = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi;
  for (const lead of leads) {
    const raw = typeof lead.email === "string" ? lead.email : "";
    const matches = raw.match(emailPattern) || [];
    for (let value of matches) {
      value = value.trim().replace(/^mailto:/i, "").toLowerCase();
      if (!value || value.length > 254) continue;
      if (/\.(png|jpe?g|gif|webp|svg|css|js)$/i.test(value)) continue;
      if (/(example\.com|yourdomain\.com)$/i.test(value)) continue;
      found.add(value);
    }
  }
  return [...found].sort();
}
async function refresh() {
  const leads = await getLeads();
  const validEmails = getUniqueValidEmails(leads);
  $("count").textContent = leads.length;
  $("emails").textContent = validEmails.length;
}
async function activeTab() {
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  return tab;
}

async function mapsTab() {
  const tab = await activeTab();
  if (!tab?.url?.includes("google.com/maps")) {
    status("Open Google Maps search results first.");
    return null;
  }
  return tab;
}
$("autoStart").addEventListener("click", async () => {
  try {
    const tab = await mapsTab();
    if (!tab) return;
    await chrome.tabs.sendMessage(tab.id, {type:"AUTO_START"});
    status("Auto collection started. Keep the Maps tab open; it will scroll and save listings automatically.");
  } catch(e) {
    status("Refresh Google Maps, then try again. The extension needs access to the Maps tab.");
  }
});
$("autoStop").addEventListener("click", async () => {
  try {
    const tab = await mapsTab();
    if (!tab) return;
    await chrome.tabs.sendMessage(tab.id, {type:"AUTO_STOP"});
    status("Stop requested.");
  } catch(e) {
    status("Could not contact the Maps tab. Refresh it and try again.");
  }
});
chrome.runtime.onMessage.addListener(message => {
  if (message?.type === "AUTO_COLLECT_PROGRESS") {
    status(`Auto collecting… ${message.count || 0} new listings collected. Keep this tab open.`);
    refresh();
  }
  if (message?.type === "AUTO_COLLECT_FINISHED") {
    status(`Auto collection finished: ${message.total || 0} new listings. ${message.reason || ""}`);
    refresh();
  }
});
$("collect").addEventListener("click", async () => {
  try {
    const tab = await activeTab();
    if (!tab?.url?.includes("google.com/maps")) { status("Open Google Maps search results first."); return; }
    const response = await chrome.tabs.sendMessage(tab.id, {type:"COLLECT_VISIBLE"});
    const existing = await getLeads();
    const map = new Map(existing.map(x => [x.name.toLowerCase()+"|"+x.website, x]));
    for (const lead of (response?.leads || [])) {
      const key = lead.name.toLowerCase()+"|"+lead.website;
      map.set(key, {...map.get(key), ...lead});
    }
    await setLeads([...map.values()]);
    await refresh();
    status(`${response?.leads?.length || 0} visible listings processed. Scroll Maps and collect again for more.`);
  } catch(e) { status("Could not read this Maps page. Refresh Google Maps and try again."); }
});
$("scan").addEventListener("click", async () => {
  try {
    const result = await chrome.runtime.sendMessage({type:"SCAN_ALL_SAVED"});
    status(`Queued ${result?.queued || 0} saved websites for background email scanning. New leads with websites will also be scanned automatically.`);
  } catch(e) {
    status("Could not start background email scanning. Reload the extension and try again.");
  }
});
$("copy").addEventListener("click", async () => {
  const leads = await getLeads();
  const emails = getUniqueValidEmails(leads);
  if (!emails.length) { status("No valid email addresses to copy yet."); return; }
  await navigator.clipboard.writeText(emails.join("\n"));
  $("emails").textContent = emails.length;
  status(`${emails.length} unique email address(es) copied.`);
});
$("export").addEventListener("click", async () => {
  const leads = await getLeads();
  if (!leads.length) { status("No leads to export."); return; }
  const cols = ["name","email","phone","website","address","mapsUrl","source","emailSource","emailScanStatus","emailScannedAt","scanNote"];
  const csv = [cols.join(","), ...leads.map(x=>cols.map(k=>`"${String(x[k]||"").replace(/"/g,'""')}"`).join(","))].join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}));
  await chrome.downloads.download({url,filename:"google-maps-leads.csv",saveAs:true});
  setTimeout(()=>URL.revokeObjectURL(url),10000);
  status("CSV export started.");
});
$("clear").addEventListener("click", async () => {
  await setLeads([]);
  await refresh();
  status("Saved leads cleared.");
});
refresh();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.leads) refresh();
});
