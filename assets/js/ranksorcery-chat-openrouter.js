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

Always present both options and encourage them to reach out — the owner is happy to help!`;

  const WELCOME_MSG = "Hey! I'm your RankSorcery AI assistant ✦ I can help with SEO audits, rankings, Core Web Vitals, schema markup, web development, ai automation and anything else to boost your Google visibility. What would you like to tackle?";

  const QUICK_CHIPS = [
	"How can ranksorcery.com help me with my website?",
    "How do I improve my Core Web Vitals?",
    "What is E-E-A-T?",	
	"Chat to a real person?",
  ];

  // ─── Proxy URL (Cloudflare Worker) ────────────────────────────────────────
  // Replace this with your Cloudflare Worker URL after deploying it
  const PROXY_URL = 'https://ranksorcery-ai-proxy.webmasterjamez.workers.dev';

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
  const chatIcon = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>`;
  const closeIcon = `<svg class="rs-icon-close" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
  const sendIcon = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`;

  document.body.insertAdjacentHTML('beforeend', `
    <button id="rs-chat-fab" aria-label="Open RankSorcery AI Chat">
      ${chatIcon}${closeIcon}
    </button>
    <div id="rs-chat-window" role="dialog" aria-label="RankSorcery AI Chat">
      <div id="rs-chat-header">
        <div class="rs-logo">✦</div>
        <div class="rs-header-info">
          <div class="rs-name">RankSorcery AI</div>
          <div class="rs-status"><span class="rs-status-dot"></span>Online · SEO Expert</div>
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
  let isTyping = false;
  let isOpen = false;
  let initialized = false;

  // ─── Helpers ─────────────────────────────────────────────────────────────
  function getTime() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function addMessage(role, text, chips) {
    const ms = document.getElementById('rs-messages');
    const div = document.createElement('div');
    div.className = `rs-msg rs-${role}`;
    const bubble = document.createElement('div');
    bubble.className = 'rs-bubble';
    bubble.textContent = text;
    const time = document.createElement('div');
    time.className = 'rs-msg-time';
    time.textContent = getTime();
    div.appendChild(bubble);
    div.appendChild(time);
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

  // ─── Send message (OpenRouter via Cloudflare Worker proxy) ────────────────
  async function sendMessage() {
    const input = document.getElementById('rs-user-input');
    const text = input.value.trim();
    if (!text || isTyping) return;
    input.value = '';
    input.style.height = 'auto';
    addMessage('user', text);
    history.push({ role: 'user', content: text });
    isTyping = true;
    showTyping();

    try {
      // Build OpenAI-compatible messages array (used by OpenRouter)
      const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history.map(m => ({ role: m.role, content: m.content })),
      ];

      const res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      });

      const data = await res.json();
      removeTyping();
      const reply = data.choices?.[0]?.message?.content || '';
      if (reply) {
        history.push({ role: 'assistant', content: reply });
        addMessage('bot', reply);
      } else {
        addMessage('bot', 'Something went wrong on my end — please try again!');
      }
    } catch {
      removeTyping();
      addMessage('bot', 'Connection issue — please try again in a moment.');
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
