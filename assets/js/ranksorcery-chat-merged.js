(function () {
  // ─── Config ───────────────────────────────────────────────────────────────
  const SYSTEM_PROMPT = `You are RankSorcery AI, a friendly and knowledgeable digital assistant for RankSorcery (ranksorcery.com). RankSorcery is a full-service digital agency helping businesses grow online through SEO, web development, AI automation, and more.

Services you help with:

SEO & SEO Tools
- AI-powered SEO audits analyzing 60+ SEO factors
- Core Web Vitals analysis (LCP, FID, CLS)
- Schema markup analysis and implementation
- E-E-A-T scoring and improvement
- Technical SEO (crawlability, indexing, site speed)
- Keyword research and content optimization
- Competitor analysis and mobile SEO
- CMS-specific fixes (WordPress, Shopify, Wix, Squarespace, Webflow, etc.)

Web Development & Full Stack Web Development
- Custom website design and development
- Fast, responsive, mobile-friendly websites
- CMS integration and e-commerce solutions
- Performance optimization and hosting setup

Web Applications & Full Stack Web Applications
- Custom web app development (dashboards, portals, SaaS tools)
- Database design, APIs, and backend systems
- Scalable full stack solutions tailored to business needs

AI Automation & AI Chatbots
- Intelligent chatbot development for websites and apps
- AI-powered workflow automation to save time and money
- Custom AI tools and integrations for businesses

Social Media Marketing
- Social media strategy and content planning
- Paid ads management (Facebook, Instagram, Google, etc.)
- Brand growth and audience engagement

Your personality: expert but approachable, like a knowledgeable friend who happens to be a digital wizard. Use clear language, avoid unnecessary jargon, and always tie advice back to RankSorcery's services when relevant. When users ask about auditing their site, mention they can paste their URL directly at ranksorcery.com to get a free AI-powered audit in seconds.

Keep responses concise — 2-4 sentences for simple questions, slightly more for complex ones. Never use bullet lists unless the user specifically asks for a breakdown.

If a user wants to contact the owner, speak to a real person, or needs direct help, share these contact details:
- 📧 Email: webmasterjamez@gmail.com
- 💬 WhatsApp: https://wa.me/639190047872
- 💼 LinkedIn: https://www.linkedin.com/in/james-carla-966abb2a9/

Always present all options and encourage them to reach out — the owner is happy to help!`;

  const WELCOME_MSG = "Hey! I'm your RankSorcery AI assistant ✦ I can help with SEO audits, web development, web applications, AI automation, social media marketing, and anything else to grow your business online. What would you like to tackle?";

  const QUICK_CHIPS = [
    "What services does RankSorcery offer?",
    "I need a website built",
    "How can AI automation help my business?",
    "Chat to a real person?",
  ];

  // ─── Proxy URL (Cloudflare Worker) ────────────────────────────────────────
  const PROXY_URL = 'https://ranksorcery-ai-proxy.webmasterjamez.workers.dev';

  // ─── Owner contact details ────────────────────────────────────────────────
  const OWNER_EMAIL      = 'webmasterjamez@gmail.com';
  const OWNER_WHATSAPP   = 'https://wa.me/639190047872';
  const OWNER_LINKEDIN   = 'https://www.linkedin.com/in/james-carla-966abb2a9/';

  // ─── Max history to keep (prevents token overflow) ────────────────────────
  const MAX_HISTORY = 10;

  // =========================================================
  // ─── CONTACT INTENT DETECTION ────────────────────────────
  // =========================================================
  const CONTACT_INTENT_PATTERNS = [
    /\b(talk|speak|chat|message|contact)\s*(to|with)?\s*(you|owner|jamez|real\s*person|human|someone)\b/i,
    /\breal\s*person\b/i,
    /\bhuman\s*(support|help|agent)\b/i,
    /\bcan\s+i\s+(talk|speak|chat)\b/i,
    /\bi\s+want\s+to\s+(talk|speak|chat)\b/i,
    /\bforward.*chat\b/i,
    /\bget\s+in\s+touch\b/i,
    /\bcontact\s+(owner|jamez|you)\b/i,
    /\bspeak\s+to\s+(a\s+)?(human|person|real|owner|jamez)\b/i,
    /\btalk\s+to\s+(a\s+)?(human|person|real|owner|jamez)\b/i,
    /\bchat\s+to\s+(a\s+)?(real\s+)?person\b/i,
    /^(contact|help|human|jamez|owner|founder)$/i,
    /\b(talk|speak|chat|message|contact)\s*(to|with)?\s*(the\s+)?(owner|founder)\b/i,
    /\bi\s+wanna\s+(talk|speak|chat)\s*(to|with)?\s*(the\s+)?(owner|founder)\b/i,
    /\bi\s+want\s+to\s+(talk|speak|chat)\s*(to|with)?\s*(the\s+)?(owner|founder)\b/i,
  ];

  function isContactIntent(text) {
    // Also match the quick chip
    if (text.toLowerCase().includes('chat to a real person')) return true;
    return CONTACT_INTENT_PATTERNS.some(p => p.test(text.trim()));
  }

  // =========================================================
  // ─── LOCAL FALLBACK BRAIN (rule-based) ───────────────────
  // =========================================================
  const CONTACT_HTML = `Feel free to reach out anytime!<br>
📧 <a href="mailto:${OWNER_EMAIL}">${OWNER_EMAIL}</a><br>
💬 <a href="${OWNER_WHATSAPP}" target="_blank">WhatsApp Jamez here</a><br>
💼 <a href="${OWNER_LINKEDIN}" target="_blank">LinkedIn</a> — Jamez is happy to help!`;

  const AUDIT_MSG = `You can get a free AI-powered SEO audit in seconds — just paste your URL directly at <a href="https://ranksorcery.com" target="_blank">ranksorcery.com</a>! It checks 60+ SEO factors including Core Web Vitals, schema markup, and E-E-A-T scoring.`;

  const localRules = [
    {
      patterns: [/\bhello\b/i, /\bhi\b/i, /\bhey\b/i, /\bgreetings\b/i, /\bgood (morning|afternoon|evening)\b/i, /\bwassup\b/i, /\bsup\b/i],
      responses: [
        "Hey there! 👋 I'm your RankSorcery assistant. Whether you need help with SEO, web development, AI automation, or social media — I've got you covered. What can I help you with today?",
        "Hi! Welcome to RankSorcery! I'm here to help you grow your online presence. What are you looking to improve — SEO, your website, or something else?"
      ]
    },
    {
      patterns: [/\bseo\b/i, /\bsearch engine\b/i, /\brank(ing)?\b/i, /\bgoogle rank/i, /\boptimiz/i, /\borganic traffic\b/i, /\bkeyword(s)?\b/i],
      responses: [
        `SEO is where the magic happens! 🔮 RankSorcery offers AI-powered SEO audits that analyze 60+ factors — from Core Web Vitals and schema markup to E-E-A-T scoring and competitor analysis. ${AUDIT_MSG}`,
        `Great question! Our SEO services cover everything from technical fixes to keyword research and content optimization. The best first step? ${AUDIT_MSG}`
      ]
    },
    {
      patterns: [/\baudit\b/i, /\bcheck my site\b/i, /\banalyze my\b/i, /\bsite report\b/i, /\bwebsite report\b/i],
      responses: [
        AUDIT_MSG,
        `Want to see exactly what's holding your site back? ${AUDIT_MSG}`
      ]
    },
    {
      patterns: [/\bcore web vitals\b/i, /\blcp\b/i, /\bfid\b/i, /\bcls\b/i, /\bpage speed\b/i, /\bsite speed\b/i, /\btechnical seo\b/i, /\bcrawl\b/i, /\bindex\b/i],
      responses: [
        "Core Web Vitals can make or break your Google rankings! We analyze LCP, FID, and CLS as part of our technical SEO service — plus crawlability, indexing, and site speed. Run a free audit at ranksorcery.com to see where you stand instantly!"
      ]
    },
    {
      patterns: [/\bschema\b/i, /\bstructured data\b/i, /\be-e-a-t\b/i, /\beat\b/i, /\bauthority\b/i, /\btrust\b/i],
      responses: [
        "Schema markup and E-E-A-T signals are huge ranking factors that most sites overlook. RankSorcery analyzes both and gives you clear implementation steps to boost your authority in Google's eyes. 🔍"
      ]
    },
    {
      patterns: [/\bweb dev\b/i, /\bwebsite design\b/i, /\bbuild.*(website|site)\b/i, /\b(website|site).*(build|create|make)\b/i, /\bnew website\b/i, /\bresponsive\b/i, /\bmobile.*(friendly|first)\b/i, /\bcms\b/i, /\bwordpress\b/i, /\bshopify\b/i, /\bwix\b/i, /\bwebflow\b/i, /\bsquarespace\b/i],
      responses: [
        "Need a website that actually converts? 💻 RankSorcery builds fast, responsive, mobile-friendly websites with CMS integration (WordPress, Shopify, Wix, Webflow — you name it). We handle everything from design to hosting setup.",
        "We create custom websites built for speed, SEO, and conversions. Whether you need a simple business site or a full e-commerce solution, we've got you covered. Want to discuss your project?"
      ]
    },
    {
      patterns: [/\bweb app\b/i, /\bapplication\b/i, /\bdashboard\b/i, /\bportal\b/i, /\bsaas\b/i, /\bbackend\b/i, /\bdatabase\b/i, /\bapi\b/i, /\bfull.?stack\b/i],
      responses: [
        "We build custom web applications from the ground up — dashboards, client portals, SaaS tools, you name it. Our full stack solutions include database design, APIs, and scalable backend systems. Got an idea? Let's bring it to life! 🚀"
      ]
    },
    {
      patterns: [/\bai\b/i, /\bchatbot\b/i, /\bautomation\b/i, /\bworkflow\b/i, /\bartificial intelligence\b/i, /\bai tool\b/i, /\bautomate\b/i],
      responses: [
        "AI is changing the game! 🤖 RankSorcery builds intelligent chatbots for websites and apps, AI-powered workflow automation to save you time and money, and custom AI tools tailored to your business needs. Sounds like something you'd be interested in?",
        "Great timing — AI automation is one of our specialties! We can build custom chatbots, automate repetitive workflows, and integrate AI tools directly into your business. Want to explore what's possible?"
      ]
    },
    {
      patterns: [/\bsocial media\b/i, /\bfacebook\b/i, /\binstagram\b/i, /\btiktok\b/i, /\bads\b/i, /\bpaid ads\b/i, /\bbrand\b/i, /\bcontent plan\b/i, /\bengagement\b/i, /\baudience\b/i, /\bmarketing\b/i],
      responses: [
        "Social media done right can seriously accelerate your growth! 📱 We handle strategy, content planning, paid ads (Facebook, Instagram, Google, and more), and audience engagement. We grow your brand while you focus on running your business.",
        "From organic content to paid ad campaigns, RankSorcery's social media marketing service covers it all — strategy, execution, and results. Want to know how we can grow your brand?"
      ]
    },
    {
      patterns: [/\bprice\b/i, /\bpric(ing|es)\b/i, /\bcost\b/i, /\bhow much\b/i, /\brate(s)?\b/i, /\bpackage(s)?\b/i, /\bplan(s)?\b/i, /\bquote\b/i, /\bbudget\b/i],
      responses: [
        `Pricing depends on the scope of your project — every business is different! The best way to get an accurate quote is to reach out directly so we can understand exactly what you need.<br><br>${CONTACT_HTML}`,
        `Great question! Our pricing is customized based on your goals and project size. Let's chat and figure out the best solution for your budget.<br><br>${CONTACT_HTML}`
      ]
    },
    {
      patterns: [/\bthank(s| you)\b/i, /\bthanks\b/i, /\bbye\b/i, /\bgoodbye\b/i, /\bsee you\b/i, /\btake care\b/i, /\bcheers\b/i],
      responses: [
        "You're welcome! Feel free to come back anytime. Best of luck with your digital journey! 🔮",
        "Thanks for stopping by! If you ever need SEO help, a new website, or anything digital — RankSorcery is here. Take care! 👋"
      ]
    },
    {
      patterns: [/\bawesome\b/i, /\bamazing\b/i, /\bgreat\b/i, /\bnice\b/i, /\bcool\b/i, /\bimpressive\b/i, /\bwow\b/i, /\bexcellent\b/i],
      responses: [
        "Thank you so much! 😊 That means a lot. Is there anything else I can help you with?",
        "Glad you think so! We put a lot of care into everything we do. Anything else on your mind?"
      ]
    },
    {
      patterns: [/\bservices?\b/i, /\bwhat (do|can) you\b/i, /\bwhat (do|does) ranksorcery\b/i, /\bwhat you offer\b/i, /\bofferings?\b/i, /\bhelp me with\b/i],
      responses: [
        "RankSorcery is your all-in-one digital growth partner! 🧙 We specialize in SEO, web development, full stack web apps, AI automation & chatbots, and social media marketing. Which area would you like to explore?",
        "We do it all — SEO audits, custom websites, web apps, AI tools, and social media marketing. What's the biggest challenge your business is facing right now?"
      ]
    }
  ];

  const localFallbacks = [
    `Hmm, I'm not sure about that specific topic — but I'm built for all things digital! Try asking me about SEO, website development, AI tools, or social media. Or if you'd like to speak with Jamez directly:<br><br>${CONTACT_HTML}`,
    `That's a bit outside my spell book! 🔮 For detailed questions, the best move is to reach out directly:<br><br>${CONTACT_HTML}`,
    `I may not have that answer, but Jamez definitely does! Feel free to reach out:<br><br>${CONTACT_HTML}`
  ];

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // Local fallback: returns HTML string response
  function getLocalResponse(input) {
    const lower = input.toLowerCase().trim();
    for (const rule of localRules) {
      if (rule.patterns.some(p => p.test(lower))) {
        return pickRandom(rule.responses);
      }
    }
    return pickRandom(localFallbacks);
  }

  // ─── Helper: is this response a "forbidden" / rate-limit error? ───────────
  function isForbiddenError(httpStatus, data) {
    if (httpStatus === 403) return true;
    if (httpStatus === 429) return true;
    if (httpStatus === 402) return true;
    if (httpStatus >= 400 && httpStatus < 600) return true;
    const errMsg = (data?.error?.message || '').toLowerCase();
    if (errMsg.includes('forbidden') || errMsg.includes('quota') || errMsg.includes('limit') || errMsg.includes('unauthorized') || errMsg.includes('rate')) return true;
    return false;
  }

  // ─── Forward chat to LinkedIn ─────────────────────────────────────────────
  function forwardToLinkedIn() {
    // Build a clean plain-text transcript of the conversation
    const transcript = history
      .map(m => {
        const who = m.role === 'user' ? 'Visitor' : 'Bot';
        // Strip HTML tags for clean text
        const clean = m.content.replace(/<[^>]+>/g, '').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
        return `${who}: ${clean}`;
      })
      .join('\n\n');

    const fullMsg = `Hi Jamez! A visitor from ranksorcery.com wants to continue their chat with you:\n\n──────────────\n${transcript}\n──────────────\n\nPlease follow up when you get a chance! 😊`;

    // Copy transcript to clipboard, then open LinkedIn
    navigator.clipboard.writeText(fullMsg)
      .then(() => {
        addMessage('bot',
          '✅ <strong>Chat transcript copied to your clipboard!</strong><br><br>' +
          'Opening LinkedIn now — just send Jamez a message and paste (Ctrl+V) the transcript so he has the full context. He\'ll get right back to you! 🚀'
        );
      })
      .catch(() => {
        addMessage('bot',
          '💼 Opening LinkedIn now! Please let Jamez know you were chatting on ranksorcery.com. He\'s happy to help! 😊'
        );
      });

    window.open(OWNER_LINKEDIN, '_blank');
  }

  // ─── Show contact card with LinkedIn forward button ───────────────────────
  function showContactCard() {
    const html =
      `Sure thing! 😊 Here's how you can reach <strong>Jamez</strong> directly:<br><br>` +
      `📧 <a href="mailto:${OWNER_EMAIL}">${OWNER_EMAIL}</a><br>` +
      `💬 <a href="${OWNER_WHATSAPP}" target="_blank">WhatsApp Jamez</a><br>` +
      `💼 <a href="${OWNER_LINKEDIN}" target="_blank">LinkedIn</a><br><br>` +
      `<em>Would you like me to forward this chat conversation directly to Jamez on LinkedIn?</em>`;

    addMessage('bot', html, null, [
      { label: '💼 Yes, forward my chat to Jamez', action: 'forward-linkedin' },
      { label: '✖ No thanks', action: 'no-forward' }
    ]);
    history.push({ role: 'assistant', content: html });
  }

  // ─── Styles ───────────────────────────────────────────────────────────────
  const css = `
    #rs-chat-fab {
      position: fixed; bottom: 24px; right: 24px; z-index: 99998;
      width: 56px; height: 56px; border-radius: 50%;
      background: #f5c842; border: none; cursor: pointer;
      box-shadow: 0 4px 16px rgba(0,0,0,0.35);
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    #rs-chat-fab:hover { transform: scale(1.08); box-shadow: 0 6px 20px rgba(0,0,0,0.4); }
    #rs-chat-fab svg { width: 26px; height: 26px; fill: #1a1200; transition: opacity 0.2s; }
    #rs-chat-fab .rs-icon-close { display: none; }

    #rs-chat-window {
      position: fixed; bottom: 92px; right: 24px; z-index: 99999;
      width: 360px; height: 540px; border-radius: 16px;
      background: #0f1117; border: 1px solid #2a2e3a;
      display: none; flex-direction: column; overflow: hidden;
      box-shadow: 0 8px 40px rgba(0,0,0,0.5);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      transform: translateY(12px); opacity: 0;
      transition: transform 0.25s ease, opacity 0.25s ease;
    }
    #rs-chat-window.rs-open {
      display: flex; transform: translateY(0); opacity: 1;
    }

    #rs-chat-header {
      background: #0f1117; border-bottom: 1px solid #2a2e3a;
      padding: 12px 16px; display: flex; align-items: center; gap: 10px; flex-shrink: 0;
    }
    .rs-logo {
      width: 32px; height: 32px; border-radius: 8px;
      background: linear-gradient(135deg, #f5c842, #4fd1a5);
      display: flex; align-items: center; justify-content: center;
      font-size: 16px; flex-shrink: 0; color: #0f1117; font-weight: 700;
    }
    .rs-header-info .rs-name { font-size: 14px; font-weight: 600; color: #fff; }
    .rs-header-info .rs-status {
      font-size: 11px; color: #4fd1a5;
      display: flex; align-items: center; gap: 4px;
    }
    .rs-status-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: #4fd1a5; display: inline-block;
    }
    .rs-close-btn {
      margin-left: auto; background: none; border: none;
      color: #666; cursor: pointer; font-size: 20px; line-height: 1;
      padding: 0 2px; transition: color 0.2s;
    }
    .rs-close-btn:hover { color: #aaa; }

    #rs-messages {
      flex: 1; overflow-y: auto; padding: 14px;
      display: flex; flex-direction: column; gap: 10px;
      scroll-behavior: smooth;
    }
    #rs-messages::-webkit-scrollbar { width: 4px; }
    #rs-messages::-webkit-scrollbar-track { background: transparent; }
    #rs-messages::-webkit-scrollbar-thumb { background: #2a2e3a; border-radius: 4px; }

    .rs-msg { display: flex; flex-direction: column; max-width: 84%; }
    .rs-msg.rs-bot { align-self: flex-start; }
    .rs-msg.rs-user { align-self: flex-end; }
    .rs-bubble {
      padding: 9px 13px; border-radius: 14px;
      font-size: 13px; line-height: 1.5;
    }
    .rs-msg.rs-bot .rs-bubble {
      background: #1c2030; color: #d4d8e8;
      border-bottom-left-radius: 4px; border: 1px solid #2a2e3a;
    }
    .rs-msg.rs-user .rs-bubble {
      background: #f5c842; color: #1a1200;
      border-bottom-right-radius: 4px; font-weight: 500;
    }
    .rs-msg-time {
      font-size: 10px; color: #555c70; margin-top: 3px; padding: 0 4px;
    }
    .rs-msg.rs-user .rs-msg-time { text-align: right; }

    .rs-typing {
      display: flex; align-items: center; gap: 4px;
      padding: 11px 13px; background: #1c2030;
      border-radius: 14px; border-bottom-left-radius: 4px;
      border: 1px solid #2a2e3a; width: fit-content;
    }
    .rs-typing span {
      width: 6px; height: 6px; border-radius: 50%;
      background: #4fd1a5;
      animation: rs-bounce 1.2s ease-in-out infinite;
    }
    .rs-typing span:nth-child(2) { animation-delay: 0.2s; }
    .rs-typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes rs-bounce {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
      30% { transform: translateY(-5px); opacity: 1; }
    }

    .rs-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
    .rs-chip {
      background: #1c2030; border: 1px solid #2a2e3a;
      color: #a0a8be; font-size: 11px; padding: 4px 9px;
      border-radius: 20px; cursor: pointer;
      transition: border-color 0.2s, color 0.2s;
      font-family: inherit;
    }
    .rs-chip:hover { border-color: #f5c842; color: #f5c842; }

    /* ── Action buttons (contact / forward) ── */
    .rs-action-btns {
      display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;
    }
    .rs-action-btn {
      font-family: inherit; font-size: 12px; font-weight: 600;
      padding: 6px 12px; border-radius: 8px; cursor: pointer;
      border: none; transition: opacity 0.2s, transform 0.1s;
    }
    .rs-action-btn:active { transform: scale(0.97); }
    .rs-action-btn[data-action="forward-linkedin"] {
      background: #0a66c2; color: #fff;
    }
    .rs-action-btn[data-action="forward-linkedin"]:hover { opacity: 0.88; }
    .rs-action-btn[data-action="no-forward"] {
      background: #2a2e3a; color: #a0a8be;
    }
    .rs-action-btn[data-action="no-forward"]:hover { opacity: 0.8; }

    #rs-input-area {
      padding: 10px 12px; background: #0f1117;
      border-top: 1px solid #2a2e3a;
      display: flex; gap: 8px; align-items: flex-end; flex-shrink: 0;
    }
    #rs-user-input {
      flex: 1; background: #1c2030; border: 1px solid #2a2e3a;
      border-radius: 10px; color: #d4d8e8; font-size: 13px;
      padding: 8px 12px; resize: none; outline: none;
      font-family: inherit; line-height: 1.4; max-height: 90px;
      transition: border-color 0.2s;
    }
    #rs-user-input::placeholder { color: #555c70; }
    #rs-user-input:focus { border-color: #f5c842; }
    #rs-send-btn {
      width: 34px; height: 34px; border-radius: 8px;
      background: #f5c842; border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; transition: opacity 0.2s, transform 0.1s;
    }
    #rs-send-btn:hover { opacity: 0.88; }
    #rs-send-btn:active { transform: scale(0.95); }
    #rs-send-btn svg { width: 15px; height: 15px; fill: #1a1200; }

    .rs-powered {
      text-align: center; font-size: 10px; color: #3a3f52;
      padding: 5px 0 8px; flex-shrink: 0;
    }
    .rs-powered a { color: #3a3f52; text-decoration: none; }

    @media (max-width: 420px) {
      #rs-chat-window { width: calc(100vw - 16px); right: 8px; bottom: 80px; }
      #rs-chat-fab { right: 16px; bottom: 16px; }
    }
  `;

  // ─── Inject styles ────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ─── Build HTML ───────────────────────────────────────────────────────────
  const chatIcon  = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 1.5 L6 10 H18 Z"/><rect x="5" y="10" width="14" height="2" rx="1"/><circle cx="12" cy="14" r="2.5"/><path d="M9.5 16.2 C8 17 5.5 19 5 23 H19 C18.5 19 16 17 14.5 16.2 C13 17.5 11 17.5 9.5 16.2 Z"/><path d="M17 16 L20.5 21 L22 20 L18.5 15 Z"/><polygon points="21,13 21.5,14.5 23,14.5 21.8,15.4 22.3,16.9 21,16 19.7,16.9 20.2,15.4 19,14.5 20.5,14.5"/></svg>`;
  const closeIcon = `<svg class="rs-icon-close" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
  const sendIcon  = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`;

  document.body.insertAdjacentHTML('beforeend', `
    <button id="rs-chat-fab" aria-label="Open RankSorcery AI Chat">
      ${chatIcon}${closeIcon}
    </button>
    <div id="rs-chat-window" role="dialog" aria-label="RankSorcery AI Chat">
      <div id="rs-chat-header">
        <div class="rs-logo">✦</div>
        <div class="rs-header-info">
          <div class="rs-name">RankSorcery AI</div>
          <div class="rs-status"><span class="rs-status-dot"></span>Online · Full Stack Digital Expert</div>
        </div>
        <button class="rs-close-btn" id="rs-close-btn" aria-label="Close chat">×</button>
      </div>
      <div id="rs-messages"></div>
      <div id="rs-input-area">
        <textarea id="rs-user-input" rows="1" placeholder="Ask about SEO, audits, rankings..."></textarea>
        <button id="rs-send-btn" aria-label="Send">${sendIcon}</button>
      </div>
      <div class="rs-powered">Powered by <a href="https://ranksorcery.com" target="_blank">RankSorcery AI</a></div>
    </div>
  `);

  // ─── State ────────────────────────────────────────────────────────────────
  const history = [];
  let isTyping     = false;
  let isOpen       = false;
  let initialized  = false;

  // ─── Helpers ─────────────────────────────────────────────────────────────
  function getTime() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  /**
   * addMessage(role, htmlContent, chips, actionBtns)
   *   chips      : array of strings — quick-reply chips
   *   actionBtns : array of { label, action } — action buttons (forward, etc.)
   */
  function addMessage(role, htmlContent, chips, actionBtns) {
    const ms  = document.getElementById('rs-messages');
    const div = document.createElement('div');
    div.className = `rs-msg rs-${role}`;

    const bubble = document.createElement('div');
    bubble.className = 'rs-bubble';
    bubble.innerHTML = htmlContent;

    const time = document.createElement('div');
    time.className = 'rs-msg-time';
    time.textContent = getTime();

    div.appendChild(bubble);
    div.appendChild(time);

    // Quick-reply chips
    if (chips && chips.length) {
      const chipsDiv = document.createElement('div');
      chipsDiv.className = 'rs-chips';
      chips.forEach(c => {
        const btn = document.createElement('button');
        btn.className = 'rs-chip';
        btn.textContent = c;
        btn.addEventListener('click', () => {
          document.getElementById('rs-user-input').value = c;
          sendMessage();
        });
        chipsDiv.appendChild(btn);
      });
      div.appendChild(chipsDiv);
    }

    // Action buttons (e.g. forward to LinkedIn)
    if (actionBtns && actionBtns.length) {
      const btnsDiv = document.createElement('div');
      btnsDiv.className = 'rs-action-btns';
      actionBtns.forEach(({ label, action }) => {
        const btn = document.createElement('button');
        btn.className = 'rs-action-btn';
        btn.dataset.action = action;
        btn.textContent = label;
        btnsDiv.appendChild(btn);
      });
      div.appendChild(btnsDiv);
    }

    ms.appendChild(div);
    ms.scrollTop = ms.scrollHeight;
  }

  function showTyping() {
    const ms = document.getElementById('rs-messages');
    const el = document.createElement('div');
    el.id = 'rs-typing';
    el.className = 'rs-msg rs-bot';
    el.innerHTML = '<div class="rs-typing"><span></span><span></span><span></span></div>';
    ms.appendChild(el);
    ms.scrollTop = ms.scrollHeight;
  }

  function removeTyping() {
    const el = document.getElementById('rs-typing');
    if (el) el.remove();
  }

  // ─── Action button click delegation ──────────────────────────────────────
  document.getElementById('rs-messages').addEventListener('click', function (e) {
    const btn = e.target.closest('.rs-action-btn');
    if (!btn) return;

    const action = btn.dataset.action;

    // Disable all action buttons in this message after click
    const parentBtns = btn.closest('.rs-action-btns');
    if (parentBtns) {
      parentBtns.querySelectorAll('.rs-action-btn').forEach(b => {
        b.disabled = true;
        b.style.opacity = '0.45';
        b.style.cursor = 'default';
      });
    }

    if (action === 'forward-linkedin') {
      forwardToLinkedIn();
    } else if (action === 'no-forward') {
      addMessage('bot',
        'No problem! Feel free to reach out anytime you\'re ready. I\'m always here if you need more help. 😊'
      );
    }
  });

  // ─── Send message — contact intent first, then AI, then local fallback ───
  async function sendMessage() {
    const input = document.getElementById('rs-user-input');
    const text  = input.value.trim();
    if (!text || isTyping) return;
    input.value = '';
    input.style.height = 'auto';
    addMessage('user', text);
    history.push({ role: 'user', content: text });

    // Trim history to prevent token overflow
    if (history.length > MAX_HISTORY) {
      history.splice(0, history.length - MAX_HISTORY);
    }

    // ── 1. Check for contact / "talk to owner" intent FIRST ──────────────
    if (isContactIntent(text)) {
      showContactCard();
      return; // Don't call AI — show contact card immediately
    }

    isTyping = true;
    showTyping();

    try {
      const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history.map(m => ({ role: m.role, content: m.content })),
      ];

      const res  = await fetch(PROXY_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ messages }),
      });

      const data = await res.json();
      removeTyping();

      // ── 2. Forbidden / quota / HTTP error → use local fallback ──────────
      if (isForbiddenError(res.status, data)) {
        const localReply = getLocalResponse(text);
        history.push({ role: 'assistant', content: localReply });
        addMessage('bot', localReply);
        isTyping = false;
        return;
      }

      const reply = data.choices?.[0]?.message?.content || '';
      if (reply) {
        history.push({ role: 'assistant', content: reply });
        addMessage('bot', reply);
      } else {
        // API returned no content → fall back to local
        const localReply = getLocalResponse(text);
        history.push({ role: 'assistant', content: localReply });
        addMessage('bot', localReply);
      }

    } catch {
      // Network / fetch error → fall back to local silently
      removeTyping();
      const localReply = getLocalResponse(text);
      history.push({ role: 'assistant', content: localReply });
      addMessage('bot', localReply);
    }

    isTyping = false;
  }

  // ─── Open / close ─────────────────────────────────────────────────────────
  function openChat() {
    isOpen = true;
    const win = document.getElementById('rs-chat-window');
    const fab = document.getElementById('rs-chat-fab');
    win.style.display = 'flex';
    requestAnimationFrame(() => win.classList.add('rs-open'));
    fab.querySelector('svg:not(.rs-icon-close)').style.display = 'none';
    fab.querySelector('.rs-icon-close').style.display = 'block';
    if (!initialized) {
      initialized = true;
      addMessage('bot', WELCOME_MSG, QUICK_CHIPS);
    }
    setTimeout(() => document.getElementById('rs-user-input').focus(), 300);
  }

  function closeChat() {
    isOpen = false;
    const win = document.getElementById('rs-chat-window');
    const fab = document.getElementById('rs-chat-fab');
    win.classList.remove('rs-open');
    fab.querySelector('svg:not(.rs-icon-close)').style.display = '';
    fab.querySelector('.rs-icon-close').style.display = 'none';
    setTimeout(() => { win.style.display = 'none'; }, 260);
  }

  // ─── Event listeners ──────────────────────────────────────────────────────
  document.getElementById('rs-chat-fab').addEventListener('click', () => isOpen ? closeChat() : openChat());
  document.getElementById('rs-close-btn').addEventListener('click', closeChat);
  document.getElementById('rs-send-btn').addEventListener('click', sendMessage);

  const textarea = document.getElementById('rs-user-input');
  textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  textarea.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 90) + 'px';
  });
})();
