
(() => {
  if (window.__mapsLeadFinderInstalled) return;
  window.__mapsLeadFinderInstalled = true;

  const clean = s => (s || "").replace(/\s+/g, " ").trim();
  let autoRunning = false;
  let autoStopReason = "";

  function getFeed() {
    return document.querySelector('div[role="feed"]') ||
      [...document.querySelectorAll("div")].find(el => {
        const style = getComputedStyle(el);
        return el.querySelector('div[role="article"]') &&
          /(auto|scroll)/.test(style.overflowY) &&
          el.clientHeight > 250 && el.scrollHeight > el.clientHeight + 100;
      });
  }

  function extractCards() {
    const feed = getFeed();
    const cards = [...document.querySelectorAll('div[role="article"]')];
    const results = [];
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      // Only collect cards intersecting the visible Maps results panel.
      if (feed) {
        const fr = feed.getBoundingClientRect();
        if (rect.bottom < fr.top || rect.top > fr.bottom) continue;
      } else if (rect.bottom < 0 || rect.top > innerHeight) continue;

      const nameEl = card.querySelector('[class*="fontHeadline"], [aria-label][role="heading"], h3');
      const name = clean(nameEl?.innerText || nameEl?.getAttribute("aria-label"));
      if (!name) continue;
      const text = clean(card.innerText + " " + [...card.querySelectorAll("[aria-label]")].map(e => e.getAttribute("aria-label") || "").join(" "));
      const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
      const visibleEmails = [...new Set([
        ...(text.match(emailRegex) || []),
        ...[...card.querySelectorAll('a[href^="mailto:"]')].map(a => (a.getAttribute("href") || "").replace(/^mailto:/i, "").split("?")[0])
      ].map(v => v.trim().toLowerCase()).filter(v => v.length <= 254))];
      const phoneMatch = text.match(/(?:\+?\d[\d\s().-]{7,}\d)/);
      const websiteLink = [...card.querySelectorAll('a[href]')].find(a => {
        const href = a.href;
        return /^https?:/.test(href) &&
          !href.includes("google.com/maps") &&
          !/google\.(com|co\.in)\/search/.test(href);
      });
      const address = [...card.querySelectorAll('[aria-label]')]
        .map(e => e.getAttribute("aria-label"))
        .find(v => /address|road|street|market|sector|nagar|india/i.test(v || "")) || "";
      const mapsLink = card.querySelector('a[href*="/maps/place/"]')?.href || location.href;
      results.push({
        name,
        phone: phoneMatch ? clean(phoneMatch[0]) : "",
        website: websiteLink?.href || "",
        address: clean(address),
        mapsUrl: mapsLink,
        source: "Google Maps visible listing",
        email: visibleEmails.join("; "),
        emailSource: visibleEmails.length ? "Google Maps listing" : ""
      });
    }
    return results;
  }

  const leadKey = lead => `${(lead.name || "").toLowerCase()}|${(lead.website || "").toLowerCase()}|${(lead.phone || "").replace(/\D/g,"")}`;

  async function sendBatch(leads) {
    if (!leads.length) return;
    try {
      await chrome.runtime.sendMessage({type:"AUTO_SAVE_LEADS", leads});
      chrome.runtime.sendMessage({
        type:"AUTO_COLLECT_PROGRESS",
        count: leads.length,
        totalVisible: document.querySelectorAll('div[role="article"]').length
      });
    } catch (e) {}
  }

  async function runAutoCollector() {
    const seen = new Set();
    let stagnantRounds = 0;
    let previousHeight = 0;
    let totalCollected = 0;
    const maxLeads = 300;
    const maxStagnantRounds = 8;

    while (autoRunning && totalCollected < maxLeads) {
      const batch = extractCards().filter(lead => {
        const key = leadKey(lead);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      if (batch.length) {
        totalCollected += batch.length;
        stagnantRounds = 0;
        await sendBatch(batch);
      } else {
        stagnantRounds++;
      }

      if (!autoRunning) break;
      const feed = getFeed();
      if (!feed) {
        autoRunning = false;
        autoStopReason = "Could not find the Google Maps results panel. Try refreshing Maps.";
        break;
      }

      const beforeTop = feed.scrollTop;
      const heightBefore = feed.scrollHeight;
      const step = Math.max(450, Math.floor(feed.clientHeight * 0.78));
      feed.scrollBy({top: step, behavior: "smooth"});

      await new Promise(resolve => setTimeout(resolve, 1450));

      const atBottom = feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 30;
      const heightAfter = feed.scrollHeight;
      const noMovement = Math.abs(feed.scrollTop - beforeTop) < 5;
      const noGrowth = heightAfter <= Math.max(previousHeight, heightBefore);

      if (atBottom && noGrowth && (noMovement || batch.length === 0)) stagnantRounds++;
      previousHeight = heightAfter;

      chrome.runtime.sendMessage({
        type:"AUTO_COLLECT_PROGRESS",
        count: totalCollected,
        totalVisible: document.querySelectorAll('div[role="article"]').length,
        scanning: true
      });

      if (stagnantRounds >= maxStagnantRounds) {
        autoRunning = false;
        autoStopReason = "Reached the end of the loaded Maps results.";
      }
    }

    if (totalCollected >= maxLeads) {
      autoRunning = false;
      autoStopReason = `Safety limit reached (${maxLeads} listings). Start again to continue.`;
    }
    chrome.runtime.sendMessage({
      type:"AUTO_COLLECT_FINISHED",
      total: totalCollected,
      reason: autoStopReason || "Auto collection stopped."
    });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "COLLECT_VISIBLE") {
      sendResponse({leads: extractCards()});
      return false;
    }
    if (msg?.type === "AUTO_START") {
      if (autoRunning) {
        sendResponse({ok:true, alreadyRunning:true});
        return false;
      }
      autoRunning = true;
      autoStopReason = "";
      runAutoCollector();
      sendResponse({ok:true, started:true});
      return false;
    }
    if (msg?.type === "AUTO_STOP") {
      autoRunning = false;
      autoStopReason = "Stopped by you.";
      sendResponse({ok:true, stopped:true});
      return false;
    }
    return false;
  });
})();
