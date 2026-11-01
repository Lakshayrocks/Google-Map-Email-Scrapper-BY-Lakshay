
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function decodeEntities(s) {
  return (s || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&commat;|&#64;|&at;/gi, "@")
    .replace(/&period;|&#46;|&dot;/gi, ".")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ");
}
function extractEmails(html) {
  const source = decodeEntities(html);
  const mailtos = [...source.matchAll(/href\s*=\s*["']mailto:([^"'?#\s]+)/gi)].map(m => m[1]);
  const text = source
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  const candidates = [...mailtos, text];
  const found = [];
  for (const candidate of candidates) {
    const matches = candidate.match(/[A-Z0-9._%+-]+(?:@|\s*\[at\]\s*|\s*\(at\)\s*)[A-Z0-9.-]+(?:\.|\s*\[dot\]\s*|\s*\(dot\)\s*)[A-Z]{2,}/gi) || [];
    for (const match of matches) {
      const email = match.replace(/\s*\[at\]\s*|\s*\(at\)\s*/ig, "@")
        .replace(/\s*\[dot\]\s*|\s*\(dot\)\s*/ig, ".")
        .replace(/\s+/g, "").toLowerCase();
      if (email.length <= 254 && !/\.(png|jpe?g|gif|webp|svg|css|js)$/i.test(email) &&
          !/(example\.com|yourdomain\.com)$/i.test(email)) found.push(email);
    }
  }
  return [...new Set(found)];
}
function normalizeUrl(value) {
  try {
    const u = new URL(value);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    return u;
  } catch { return null; }
}
async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      method: "GET", redirect: "follow", credentials: "omit",
      signal: controller.signal,
      headers: {"Accept": "text/html,application/xhtml+xml"}
    });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") || "";
    if (type && !/text\/html|application\/xhtml\+xml/i.test(type)) return null;
    return {html: await response.text(), finalUrl: response.url || url};
  } catch { return null; }
  finally { clearTimeout(timer); }
}
async function scanWebsite(website) {
  const root = normalizeUrl(website);
  if (!root) return {emails: [], checked: [], error: "Invalid website URL"};
  const first = await fetchPage(root.href);
  if (!first) return {emails: [], checked: [], error: "Website blocked the request or could not be reached"};
  let emails = extractEmails(first.html);
  const checked = [first.finalUrl];
  const origin = root.origin;
  const paths = [];
  const linkRegex = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of first.html.matchAll(linkRegex)) {
    const href = decodeEntities(m[2]);
    const label = decodeEntities((m[3] || "").replace(/<[^>]+>/g, " "));
    if (!/(contact|about|support|customer|reach|team)/i.test(label + " " + href)) continue;
    try {
      const u = new URL(href, first.finalUrl);
      if (u.origin === origin && /^https?:$/.test(u.protocol) && !paths.includes(u.href)) paths.push(u.href);
    } catch {}
  }
  for (const path of ["/contact", "/contact-us", "/about", "/about-us"]) {
    const u = new URL(path, origin).href;
    if (!paths.includes(u)) paths.push(u);
  }
  // Fetch up to five same-domain contact/about pages concurrently.
  const pageResults = await Promise.all(paths.slice(0, 5).map(url => fetchPage(url)));
  for (const page of pageResults) {
    if (!page) continue;
    checked.push(page.finalUrl);
    emails = [...new Set([...emails, ...extractEmails(page.html)])];
  }
  return {emails: emails.slice(0, 10), checked};
}

function autoLeadKey(lead) {
  return `${(lead.name || "").toLowerCase()}|${(lead.website || "").toLowerCase()}|${(lead.phone || "").replace(/\D/g,"")}`;
}

const AUTO_SCAN_CONCURRENCY = 10;
let autoScanQueue = [];
let autoScanRunning = 0;
let autoScanSeen = new Set();

function hasEmailValue(lead) {
  return (lead.email || "").split(";").some(v => v.trim().includes("@"));
}
function mergeLead(oldLead, newLead) {
  const merged = {...oldLead};
  for (const [key, value] of Object.entries(newLead)) {
    if (value !== undefined && value !== null && value !== "") merged[key] = value;
  }
  // Never erase a previously discovered email with an empty Maps scrape.
  if (!newLead.email && oldLead.email) merged.email = oldLead.email;
  return merged;
}
function enqueueLeadForEmailScan(lead) {
  if (!lead.website || hasEmailValue(lead)) return;
  const key = autoLeadKey(lead);
  if (autoScanSeen.has(key)) return;
  autoScanSeen.add(key);
  autoScanQueue.push({...lead, __key:key});
  pumpAutoScanQueue();
}
async function saveEmailScanResult(key, result) {
  const data = await chrome.storage.local.get({leads:[]});
  const leads = data.leads;
  const index = leads.findIndex(lead => autoLeadKey(lead) === key);
  if (index < 0) return;
  const emails = result?.emails || [];
  leads[index] = {
    ...leads[index],
    email: emails.length ? [...new Set([
      ...(leads[index].email || "").split(";").map(v=>v.trim()).filter(v=>v.includes("@")),
      ...emails
    ])].join("; ") : (leads[index].email || "Not found"),
    emailSource: [leads[index].emailSource, ...(result?.checked || [])].filter(Boolean).join("; "),
    scanNote: result?.error || "",
    emailScanStatus: emails.length ? "found" : (result?.error ? "failed" : "checked"),
    emailScannedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({leads});
}
async function scanQueuedLead(lead) {
  try {
    const result = await scanWebsite(lead.website);
    await saveEmailScanResult(lead.__key, result);
  } catch (e) {
    await saveEmailScanResult(lead.__key, {emails:[], checked:[], error:"Website scan failed"});
  }
}
function pumpAutoScanQueue() {
  while (autoScanRunning < AUTO_SCAN_CONCURRENCY && autoScanQueue.length) {
    const lead = autoScanQueue.shift();
    autoScanRunning++;
    scanQueuedLead(lead).finally(() => {
      autoScanRunning--;
      autoScanSeen.delete(lead.__key);
      pumpAutoScanQueue();
    });
  }
}
async function addCollectedLeads(newLeads) {
  const data = await chrome.storage.local.get({leads:[]});
  const map = new Map(data.leads.map(lead => [autoLeadKey(lead), lead]));
  for (const lead of newLeads) {
    const key = autoLeadKey(lead);
    const merged = mergeLead(map.get(key) || {}, lead);
    map.set(key, merged);
  }
  const allLeads = [...map.values()];
  await chrome.storage.local.set({leads:allLeads});
  // Automatically scan newly collected leads that have a website and no email yet.
  for (const lead of newLeads) {
    const saved = map.get(autoLeadKey(lead));
    if (saved) enqueueLeadForEmailScan(saved);
  }
  return {saved:newLeads.length, total:allLeads.length};
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "AUTO_SAVE_LEADS" && Array.isArray(message.leads)) {
    addCollectedLeads(message.leads).then(sendResponse).catch(() => sendResponse({error:"Could not save leads"}));
    return true;
  }
  if (message?.type === "SCAN_ALL_SAVED") {
    chrome.storage.local.get({leads:[]}, data => {
      const targets = data.leads.filter(lead => lead.website && !hasEmailValue(lead));
      for (const lead of targets) enqueueLeadForEmailScan(lead);
      sendResponse({queued:targets.length, total:data.leads.length});
    });
    return true;
  }
  if (message?.type === "GET_SCAN_QUEUE_STATUS") {
    sendResponse({queued:autoScanQueue.length, running:autoScanRunning});
    return false;
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SCAN_WEBSITE" && typeof message.website === "string") {
    scanWebsite(message.website).then(sendResponse).catch(() =>
      sendResponse({emails: [], checked: [], error: "Scan failed"})
    );
    return true;
  }
});
