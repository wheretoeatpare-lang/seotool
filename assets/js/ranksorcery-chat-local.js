// ============================================================
// RankSorcery Local Chatbot — No API Required
// Rule-based chatbot with keyword intent matching
// ============================================================

(function () {
  // ── CONFIG ────────────────────────────────────────────────
  const BOT_NAME = "Sorcerer";
  const BOT_AVATAR = "🧙";
  const TYPING_DELAY_MS = 600;
  const WIDGET_COLOR = "#6c3fd4"; // purple — change to match your brand

  // ── KNOWLEDGE BASE ────────────────────────────────────────
  const CONTACT_HTML = `Feel free to reach out anytime!<br>
📧 <a href="mailto:webmasterjamez@gmail.com">webmasterjamez@gmail.com</a><br>
💬 <a href="https://wa.me/639190047872" target="_blank">WhatsApp us here</a> — Jamez is happy to help!`;

  const AUDIT_MSG = `You can get a <strong>free AI-powered SEO audit in seconds</strong> — just paste your URL directly at <a href="https://ranksorcery.com" target="_blank">ranksorcery.com</a>! It checks 60+ SEO factors including Core Web Vitals, schema markup, and E-E-A-T scoring.`;

  const rules = [
    // ── Greetings ──
    {
      patterns: [/\bhello\b/i, /\bhi\b/i, /\bhey\b/i, /\bgreetings\b/i, /\bgood (morning|afternoon|evening)\b/i, /\bwassup\b/i, /\bsup\b/i],
      responses: [
        "Hey there! 👋 I'm Sorcerer, RankSorcery's digital assistant. Whether you need help with SEO, web development, AI automation, or social media — I've got you covered. What can I help you with today?",
        "Hi! Welcome to RankSorcery! I'm here to help you grow your online presence. What are you looking to improve — SEO, your website, or something else?"
      ]
    },

    // ── SEO (general) ──
    {
      patterns: [/\bseo\b/i, /\bsearch engine\b/i, /\brank(ing)?\b/i, /\bgoogle rank/i, /\boptimiz/i, /\borganic traffic\b/i, /\bkeyword(s)?\b/i],
      responses: [
        `SEO is where the magic happens! 🔮 RankSorcery offers AI-powered SEO audits that analyze 60+ factors — from Core Web Vitals and schema markup to E-E-A-T scoring and competitor analysis. ${AUDIT_MSG}`,
        `Great question! Our SEO services cover everything from technical fixes to keyword research and content optimization. The best first step? ${AUDIT_MSG}`
      ]
    },

    // ── SEO Audit ──
    {
      patterns: [/\baudit\b/i, /\bcheck my site\b/i, /\banalyze my\b/i, /\bsite report\b/i, /\bwebsite report\b/i],
      responses: [
        AUDIT_MSG,
        `Want to see exactly what's holding your site back? ${AUDIT_MSG}`
      ]
    },

    // ── Core Web Vitals / Technical SEO ──
    {
      patterns: [/\bcore web vitals\b/i, /\blcp\b/i, /\bfid\b/i, /\bcls\b/i, /\bpage speed\b/i, /\bsite speed\b/i, /\btechnical seo\b/i, /\bcrawl\b/i, /\bindex\b/i],
      responses: [
        "Core Web Vitals can make or break your Google rankings! We analyze LCP, FID, and CLS as part of our technical SEO service — plus crawlability, indexing, and site speed. Run a free audit at ranksorcery.com to see where you stand instantly!"
      ]
    },

    // ── Schema / E-E-A-T ──
    {
      patterns: [/\bschema\b/i, /\bstructured data\b/i, /\be-e-a-t\b/i, /\beat\b/i, /\bauthority\b/i, /\btrust\b/i],
      responses: [
        "Schema markup and E-E-A-T signals are huge ranking factors that most sites overlook. RankSorcery analyzes both and gives you clear implementation steps to boost your authority in Google's eyes. 🔍"
      ]
    },

    // ── Web Development ──
    {
      patterns: [/\bweb dev\b/i, /\bwebsite design\b/i, /\bbuild.*(website|site)\b/i, /\b(website|site).*(build|create|make)\b/i, /\bnew website\b/i, /\bresponsive\b/i, /\bmobile.*(friendly|first)\b/i, /\bcms\b/i, /\bwordpress\b/i, /\bshopify\b/i, /\bwix\b/i, /\bwebflow\b/i, /\bsquarespace\b/i],
      responses: [
        "Need a website that actually converts? 💻 RankSorcery builds fast, responsive, mobile-friendly websites with CMS integration (WordPress, Shopify, Wix, Webflow — you name it). We handle everything from design to hosting setup.",
        "We create custom websites built for speed, SEO, and conversions. Whether you need a simple business site or a full e-commerce solution, we've got you covered. Want to discuss your project?"
      ]
    },

    // ── Web Applications ──
    {
      patterns: [/\bweb app\b/i, /\bapplication\b/i, /\bdashboard\b/i, /\bportal\b/i, /\bsaas\b/i, /\bbackend\b/i, /\bdatabase\b/i, /\bapi\b/i, /\bfull.?stack\b/i],
      responses: [
        "We build custom web applications from the ground up — dashboards, client portals, SaaS tools, you name it. Our full stack solutions include database design, APIs, and scalable backend systems. Got an idea? Let's bring it to life! 🚀"
      ]
    },

    // ── AI Automation / Chatbots ──
    {
      patterns: [/\bai\b/i, /\bchatbot\b/i, /\bautomation\b/i, /\bworkflow\b/i, /\bartificial intelligence\b/i, /\bai tool\b/i, /\bautomate\b/i],
      responses: [
        "AI is changing the game! 🤖 RankSorcery builds intelligent chatbots for websites and apps, AI-powered workflow automation to save you time and money, and custom AI tools tailored to your business needs. Sounds like something you'd be interested in?",
        "Great timing — AI automation is one of our specialties! We can build custom chatbots, automate repetitive workflows, and integrate AI tools directly into your business. Want to explore what's possible?"
      ]
    },

    // ── Social Media Marketing ──
    {
      patterns: [/\bsocial media\b/i, /\bfacebook\b/i, /\binstagram\b/i, /\btiktok\b/i, /\bads\b/i, /\bpaid ads\b/i, /\bbrand\b/i, /\bcontent plan\b/i, /\bengagement\b/i, /\baudience\b/i, /\bmarketing\b/i],
      responses: [
        "Social media done right can seriously accelerate your growth! 📱 We handle strategy, content planning, paid ads (Facebook, Instagram, Google, and more), and audience engagement. We grow your brand while you focus on running your business.",
        "From organic content to paid ad campaigns, RankSorcery's social media marketing service covers it all — strategy, execution, and results. Want to know how we can grow your brand?"
      ]
    },

    // ── Pricing ──
    {
      patterns: [/\bprice\b/i, /\bpric(ing|es)\b/i, /\bcost\b/i, /\bhow much\b/i, /\brate(s)?\b/i, /\bpackage(s)?\b/i, /\bplan(s)?\b/i, /\bquote\b/i, /\bbudget\b/i],
      responses: [
        `Pricing depends on the scope of your project — every business is different! The best way to get an accurate quote is to reach out directly so we can understand exactly what you need.<br><br>${CONTACT_HTML}`,
        `Great question! Our pricing is customized based on your goals and project size. Let's chat and figure out the best solution for your budget.<br><br>${CONTACT_HTML}`
      ]
    },

    // ── Contact / Talk to human ──
    {
      patterns: [/\bcontact\b/i, /\breach out\b/i, /\bspeak.*human\b/i, /\btalk.*person\b/i, /\bwhatsapp\b/i, /\bemail\b/i, /\bget in touch\b/i, /\bhire\b/i, /\bwork with\b/i, /\bowner\b/i, /\bjamez\b/i],
      responses: [
        `Absolutely! You can reach Jamez directly — he's always happy to help. 😊<br><br>${CONTACT_HTML}`,
        `Want to talk to a real person? Jamez is just a message away!<br><br>${CONTACT_HTML}`
      ]
    },

    // ── Services overview ──
    {
      patterns: [/\bservices?\b/i, /\bwhat (do|can) you\b/i, /\bwhat (do|does) ranksorcery\b/i, /\bwhat you offer\b/i, /\bofferings?\b/i, /\bhelp me with\b/i],
      responses: [
        "RankSorcery is your all-in-one digital growth partner! 🧙 We specialize in SEO, web development, full stack web apps, AI automation & chatbots, and social media marketing. Which area would you like to explore?",
        "We do it all — SEO audits, custom websites, web apps, AI tools, and social media marketing. What's the biggest challenge your business is facing right now?"
      ]
    },

    // ── Thanks / Goodbye ──
    {
      patterns: [/\bthank(s| you)\b/i, /\bthanks\b/i, /\bbye\b/i, /\bgoodbye\b/i, /\bsee you\b/i, /\btake care\b/i, /\bcheers\b/i],
      responses: [
        "You're welcome! Feel free to come back anytime. Best of luck with your digital journey! 🔮",
        "Thanks for stopping by! If you ever need SEO help, a new website, or anything digital — RankSorcery is here. Take care! 👋"
      ]
    },

    // ── Compliments ──
    {
      patterns: [/\bawesome\b/i, /\bamazing\b/i, /\bgreat\b/i, /\bnice\b/i, /\bcool\b/i, /\bimpressive\b/i, /\bwow\b/i, /\bexcellent\b/i],
      responses: [
        "Thank you so much! 😊 That means a lot. Is there anything else I can help you with?",
        "Glad you think so! We put a lot of care into everything we do. Anything else on your mind?"
      ]
    }
  ];

  // ── FALLBACK RESPONSES ────────────────────────────────────
  const fallbacks = [
    `Hmm, I'm not sure about that specific topic — but I'm built for all things digital! Try asking me about SEO, website development, AI tools, or social media. Or if you'd like to speak with Jamez directly:<br><br>${CONTACT_HTML}`,
    `That's a bit outside my spell book! 🔮 For detailed questions, the best move is to reach out directly:<br><br>${CONTACT_HTML}`,
    `I may not have that answer, but Jamez definitely does! Feel free to reach out:<br><br>${CONTACT_HTML}`
  ];

  // ── HELPERS ───────────────────────────────────────────────
  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function getResponse(input) {
    const lower = input.toLowerCase().trim();
    for (const rule of rules) {
      if (rule.patterns.some(p => p.test(lower))) {
        return pickRandom(rule.responses);
      }
    }
    return pickRandom(fallbacks);
  }

  // ── STYLES ────────────────────────────────────────────────
  const styles = `
    #rs-chat-widget * { box-sizing: border-box; font-family: 'Segoe UI', system-ui, sans-serif; }
    #rs-chat-toggle {
      position: fixed; bottom: 24px; right: 24px; width: 56px; height: 56px;
      background: ${WIDGET_COLOR}; color: #fff; border: none; border-radius: 50%;
      font-size: 26px; cursor: pointer; box-shadow: 0 4px 20px rgba(108,63,212,0.4);
      display: flex; align-items: center; justify-content: center;
      z-index: 9999; transition: transform 0.2s;
    }
    #rs-chat-toggle:hover { transform: scale(1.08); }
    #rs-chat-box {
      position: fixed; bottom: 90px; right: 24px; width: 360px; max-height: 520px;
      background: #fff; border-radius: 16px; box-shadow: 0 8px 40px rgba(0,0,0,0.18);
      display: flex; flex-direction: column; overflow: hidden; z-index: 9999;
      transition: opacity 0.2s, transform 0.2s;
    }
    #rs-chat-box.hidden { opacity: 0; pointer-events: none; transform: translateY(12px); }
    #rs-chat-header {
      background: ${WIDGET_COLOR}; color: #fff; padding: 14px 16px;
      display: flex; align-items: center; gap: 10px;
    }
    #rs-chat-header .avatar { font-size: 22px; }
    #rs-chat-header .info .name { font-weight: 700; font-size: 15px; }
    #rs-chat-header .info .status { font-size: 11px; opacity: 0.85; }
    #rs-chat-header .close-btn {
      margin-left: auto; background: none; border: none; color: #fff;
      font-size: 20px; cursor: pointer; line-height: 1; padding: 0;
    }
    #rs-chat-messages {
      flex: 1; overflow-y: auto; padding: 14px 12px; display: flex;
      flex-direction: column; gap: 10px; background: #f7f7fb;
    }
    .rs-msg { display: flex; align-items: flex-end; gap: 7px; max-width: 90%; }
    .rs-msg.bot { align-self: flex-start; }
    .rs-msg.user { align-self: flex-end; flex-direction: row-reverse; }
    .rs-bubble {
      padding: 9px 13px; border-radius: 14px; font-size: 13.5px; line-height: 1.5;
      word-break: break-word;
    }
    .rs-msg.bot .rs-bubble { background: #fff; color: #222; border: 1px solid #e5e5ef; border-bottom-left-radius: 4px; }
    .rs-msg.user .rs-bubble { background: ${WIDGET_COLOR}; color: #fff; border-bottom-right-radius: 4px; }
    .rs-msg.bot .rs-bubble a { color: ${WIDGET_COLOR}; font-weight: 600; }
    .rs-avatar-icon { font-size: 20px; flex-shrink: 0; }
    .rs-typing { display: flex; gap: 4px; padding: 10px 13px; }
    .rs-typing span {
      width: 7px; height: 7px; background: #bbb; border-radius: 50%;
      animation: rs-bounce 1.2s infinite;
    }
    .rs-typing span:nth-child(2) { animation-delay: 0.2s; }
    .rs-typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes rs-bounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-6px)} }
    #rs-chat-input-row {
      display: flex; gap: 8px; padding: 10px 12px; background: #fff;
      border-top: 1px solid #efefef;
    }
    #rs-chat-input {
      flex: 1; border: 1px solid #ddd; border-radius: 20px; padding: 8px 14px;
      font-size: 13.5px; outline: none; resize: none;
    }
    #rs-chat-input:focus { border-color: ${WIDGET_COLOR}; }
    #rs-chat-send {
      background: ${WIDGET_COLOR}; color: #fff; border: none; border-radius: 50%;
      width: 36px; height: 36px; font-size: 16px; cursor: pointer;
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    #rs-chat-send:hover { opacity: 0.88; }
    @media (max-width: 420px) {
      #rs-chat-box { width: calc(100vw - 24px); right: 12px; bottom: 80px; }
    }
  `;

  // ── HTML ──────────────────────────────────────────────────
  const html = `
    <style>${styles}</style>
    <div id="rs-chat-widget">
      <button id="rs-chat-toggle" aria-label="Open chat">${BOT_AVATAR}</button>
      <div id="rs-chat-box" class="hidden">
        <div id="rs-chat-header">
          <span class="avatar">${BOT_AVATAR}</span>
          <div class="info">
            <div class="name">${BOT_NAME} · RankSorcery</div>
            <div class="status">⚡ Always online</div>
          </div>
          <button class="close-btn" id="rs-chat-close" aria-label="Close">×</button>
        </div>
        <div id="rs-chat-messages"></div>
        <div id="rs-chat-input-row">
          <input id="rs-chat-input" type="text" placeholder="Ask me anything..." autocomplete="off" maxlength="300" />
          <button id="rs-chat-send" aria-label="Send">➤</button>
        </div>
      </div>
    </div>
  `;

  // ── MOUNT ─────────────────────────────────────────────────
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);

  const box      = document.getElementById('rs-chat-box');
  const toggle   = document.getElementById('rs-chat-toggle');
  const closeBtn = document.getElementById('rs-chat-close');
  const messages = document.getElementById('rs-chat-messages');
  const input    = document.getElementById('rs-chat-input');
  const sendBtn  = document.getElementById('rs-chat-send');

  let isOpen = false;

  function openChat() {
    isOpen = true;
    box.classList.remove('hidden');
    toggle.textContent = '×';
    if (messages.childElementCount === 0) addBotMessage(
      "Hey there! 👋 I'm Sorcerer, RankSorcery's assistant. Ask me about SEO, web development, AI tools, social media — or anything else I can help with!"
    );
    setTimeout(() => input.focus(), 100);
  }

  function closeChat() {
    isOpen = false;
    box.classList.add('hidden');
    toggle.textContent = BOT_AVATAR;
  }

  toggle.addEventListener('click', () => isOpen ? closeChat() : openChat());
  closeBtn.addEventListener('click', closeChat);

  function addBotMessage(html, isTyping = false) {
    const wrapper = document.createElement('div');
    wrapper.className = 'rs-msg bot';

    const icon = document.createElement('span');
    icon.className = 'rs-avatar-icon';
    icon.textContent = BOT_AVATAR;

    const bubble = document.createElement('div');
    bubble.className = 'rs-bubble';

    if (isTyping) {
      bubble.innerHTML = `<div class="rs-typing"><span></span><span></span><span></span></div>`;
      wrapper.id = 'rs-typing-indicator';
    } else {
      bubble.innerHTML = html;
    }

    wrapper.appendChild(icon);
    wrapper.appendChild(bubble);
    messages.appendChild(wrapper);
    messages.scrollTop = messages.scrollHeight;
    return wrapper;
  }

  function addUserMessage(text) {
    const wrapper = document.createElement('div');
    wrapper.className = 'rs-msg user';
    const bubble = document.createElement('div');
    bubble.className = 'rs-bubble';
    bubble.textContent = text;
    wrapper.appendChild(bubble);
    messages.appendChild(wrapper);
    messages.scrollTop = messages.scrollHeight;
  }

  function sendMessage() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    addUserMessage(text);

    const typingEl = addBotMessage('', true);

    setTimeout(() => {
      typingEl.remove();
      addBotMessage(getResponse(text));
    }, TYPING_DELAY_MS + Math.random() * 400);
  }

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

})();
