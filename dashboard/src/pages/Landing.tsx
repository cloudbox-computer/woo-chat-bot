import React from "react";

const features = [
  ["Grounded answers", "Answers from your website, knowledge base and connected business data — with guardrails designed to reduce made-up answers."],
  ["Live business tools", "Let the assistant search products, check orders, read customer data, create tickets and use the capabilities you enable."],
  ["Any website, one snippet", "Add the assistant with a lightweight embed. Use it on WordPress, WooCommerce, React sites and other websites that accept JavaScript."],
  ["Human-ready tickets", "When a question needs a person, the assistant can collect the details and create a support ticket for your team."],
  ["Multi-tenant by design", "Run separate assistants for different businesses, brands or client accounts with isolated configuration and data."],
  ["Your brand, your rules", "Set the assistant name, tone, welcome message, colours, quick actions, allowed topics and refusal behaviour."],
];

const plans = [
  { key: "starter" as const, name: "Starter", price: "£29", desc: "For small businesses launching AI support.", items: ["1 AI assistant", "500 conversations / month", "Website & knowledge answers", "Support ticket creation", "Custom branding", "Email support"] },
  { key: "growth" as const, name: "Growth", price: "£79", desc: "For growing teams that need live integrations.", popular: true, items: ["3 AI assistants", "2,500 conversations / month", "Everything in Starter", "Product & order integrations", "Business-data tools", "Team dashboard & analytics", "Priority support"] },
  { key: "scale" as const, name: "Scale", price: "£199", desc: "For higher-volume businesses and agencies.", items: ["10 AI assistants", "10,000 conversations / month", "Everything in Growth", "Advanced permissions", "Audit & operational controls", "Higher usage limits", "Priority onboarding"] },
];

const faqs = [
  ["What is an AI customer service chatbot?", "An AI customer service chatbot is a website assistant that answers customer questions automatically. ZoChat can use your approved website content, knowledge and connected business systems so customers can get help at any time."],
  ["Can I add ZoChat to WordPress or WooCommerce?", "Yes. ZoChat is designed to be embedded with a small JavaScript snippet and can connect to WooCommerce capabilities such as products and orders when you configure that integration."],
  ["Does it work for businesses that are not ecommerce stores?", "Yes. The platform is provider-agnostic and tenant-configurable. A service business can use knowledge, website content, tickets and configured business-data resources without enabling ecommerce tools."],
  ["Can the chatbot check orders or product information?", "Yes, when the relevant integration and permissions are enabled. The assistant calls server-side tools for live information rather than relying on the language model to guess those facts."],
  ["What happens when the AI cannot answer?", "You control its scope and fallback behaviour. It can say that it does not have the information and, when appropriate, collect the issue and create a support ticket for your team."],
  ["Can I customise the chatbot?", "Yes. You can configure branding, tone, welcome text, quick actions, knowledge, allowed topics, integrations and tool permissions for each assistant."],
  ["Is ZoChat suitable for agencies or multiple brands?", "Yes. The platform was built around tenants and separate assistants, so multiple businesses or brands can be managed without sharing their configuration."],
  ["How much does ZoChat cost?", "Plans shown on this page start at £29 per month for Starter, £79 per month for Growth and £199 per month for Scale. Enterprise requirements can be quoted separately."],
];

export default function Landing({ onLogin, onChoosePlan }: { onLogin: () => void; onChoosePlan: (plan: "starter" | "growth" | "scale") => void }) {
  React.useEffect(() => {
    document.title = "ZoChat — AI Customer Service Chatbot for Websites & WooCommerce";
  }, []);
  return <div className="landing">
    <header className="lp-nav"><a className="lp-logo" href="#top" aria-label="ZoChat home"><span>◆</span> ZoChat</a><nav><a href="#features">Features</a><a href="#integrations">Integrations</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a></nav><button className="lp-login" onClick={onLogin}>Log in</button><button className="lp-nav-cta" onClick={onLogin}>Get started <span>→</span></button></header>

    <main id="top">
      <section className="lp-hero">
        <div className="lp-glow lp-glow-a"/><div className="lp-glow lp-glow-b"/>
        <div className="lp-eyebrow"><i/> AI customer support that works from your real business data</div>
        <h1>Your website's <em>best support agent</em>.<br/>Online 24/7.</h1>
        <p className="lp-lead">Give customers instant, useful answers from your website, knowledge and connected systems. ZoChat can answer questions, find products, check orders and raise tickets — while staying inside the rules you set.</p>
        <div className="lp-actions"><button className="lp-primary" onClick={onLogin}>Start building your assistant <span>→</span></button><a className="lp-secondary" href="#how">See how it works</a></div>
        <p className="lp-micro">Simple setup · One-line website embed · Built for UK businesses and teams worldwide</p>

        <div className="lp-product-shot" aria-label="ZoChat product preview">
          <div className="lp-window"><div className="lp-windowbar"><b>ZoChat Dashboard</b><span/><span/><span/></div><div className="lp-dash">
            <aside><strong>◆ ZoChat</strong><small>WORKSPACE</small>{["Overview","Chatbot","Knowledge","Integrations","Tickets"].map((x,i)=><div className={i===0?"sel":""} key={x}>{x}</div>)}</aside>
            <div className="lp-dashmain"><div className="lp-dashhead"><div><small>OVERVIEW</small><h3>Your assistant at a glance</h3></div><button>Live ●</button></div><div className="lp-stats"><div><small>CONVERSATIONS</small><b>1,284</b><span>↗ 18% this month</span></div><div><small>AI RESOLUTION</small><b>81%</b><span>Routine questions handled</span></div><div><small>TICKETS CREATED</small><b>47</b><span>Needs human attention</span></div></div><div className="lp-chart"><div><small>CONVERSATIONS</small><b>Customer demand</b></div><svg viewBox="0 0 600 130" preserveAspectRatio="none"><path d="M0,105 C45,100 50,62 92,75 S160,112 205,70 S270,25 320,52 S390,95 440,55 S520,18 600,30" fill="none" stroke="currentColor" strokeWidth="3"/><path d="M0,105 C45,100 50,62 92,75 S160,112 205,70 S270,25 320,52 S390,95 440,55 S520,18 600,30 L600,130 L0,130Z" fill="currentColor" opacity=".07"/></svg></div></div>
          </div></div>
          <div className="lp-chat-card"><div className="lp-chat-head"><span className="lp-avatar">◆</span><div><b>AI Assistant</b><small><i/> Online now</small></div></div><div className="lp-msg bot">Hi! How can I help today?</div><div className="lp-msg user">Where is my order #4821?</div><div className="lp-msg bot">I can check that for you. Please confirm the email used for the order.</div><div className="lp-typing">● ● ●</div></div>
        </div>
      </section>

      <section className="lp-proof"><span>BUILT FOR THE TOOLS YOUR BUSINESS ALREADY USES</span><div><b>Woo</b><b>WordPress</b><b>Supabase</b><b>OpenAI</b><b>Gemini</b><b>Custom data</b></div></section>

      <section className="lp-section" id="features"><div className="lp-section-kicker">WHY ZOCHAT</div><h2>More than a chatbot.<br/><em>A useful member of the team.</em></h2><p className="lp-section-intro">Generic chatbots only talk. ZoChat is built to use approved knowledge and connected capabilities, so it can help customers complete real support journeys.</p><div className="lp-feature-grid">{features.map(([t,d],i)=><article key={t}><span className="lp-feature-icon">{["◎","⌁","↗","◇","▦","✦"][i]}</span><h3>{t}</h3><p>{d}</p></article>)}</div></section>

      <section className="lp-dark" id="how"><div className="lp-section-kicker">HOW IT WORKS</div><h2>From signup to helpful<br/>customer conversations.</h2><div className="lp-steps"><article><b>01</b><h3>Teach it your business</h3><p>Add your website, business context, FAQs and knowledge. Define exactly what the assistant should and should not discuss.</p></article><article><b>02</b><h3>Connect live capabilities</h3><p>Connect the systems you need. ZoChat's tool layer can retrieve live information without exposing the underlying provider to the AI.</p></article><article><b>03</b><h3>Embed and improve</h3><p>Add one script to your site, review conversations and tickets in the dashboard, then refine knowledge and behaviour as you learn.</p></article></div></section>

      <section className="lp-section lp-integrations" id="integrations"><div className="lp-copy"><div className="lp-section-kicker">PROVIDER-AGNOSTIC INTEGRATIONS</div><h2>One assistant.<br/><em>Your systems behind it.</em></h2><p>ZoChat's AI asks for capabilities — such as product search, order lookup or business data — while the server decides which connected integration fulfils the request. That keeps the assistant flexible as your stack changes.</p><div className="lp-checks"><span>✓ Live product and catalogue search</span><span>✓ Customer-verified order lookup</span><span>✓ Knowledge and website answers</span><span>✓ Support ticket creation</span><span>✓ Configurable business-data resources</span><span>✓ Per-assistant tool permissions</span></div></div><div className="lp-orbit"><div className="lp-core">◆<b>ZoChat</b><small>AI layer</small></div>{["WooCommerce","Supabase","Knowledge","Website","Tickets","Custom API"].map((x,i)=><div key={x} className={`lp-node n${i}`}>{x}</div>)}</div></section>

      <section className="lp-section lp-pricing" id="pricing"><div className="lp-section-kicker">SIMPLE PRICING</div><h2>Start small. <em>Scale when support grows.</em></h2><p className="lp-section-intro">Straightforward monthly plans for businesses that want an AI customer service assistant on their website.</p><div className="lp-price-grid">{plans.map(p=><article className={p.popular?"popular":""} key={p.name}>{p.popular&&<div className="lp-popular">MOST POPULAR</div>}<h3>{p.name}</h3><p>{p.desc}</p><div className="lp-price"><b>{p.price}</b><span>/ month<br/><small>ex VAT</small></span></div><button onClick={()=>onChoosePlan(p.key)}>{p.popular?"Choose Growth":"Get started"} <span>→</span></button><ul>{p.items.map(x=><li key={x}>✓ {x}</li>)}</ul></article>)}</div><p className="lp-price-note">Need custom volume, dedicated onboarding or enterprise controls? Choose a plan to create your account and discuss a tailored setup with the team.</p></section>

      <section className="lp-answer-section"><div><div className="lp-section-kicker">BUILT FOR SEARCH & ANSWER ENGINES</div><h2>What can an AI customer service chatbot do?</h2></div><div><p>An <strong>AI customer service chatbot</strong> can answer common questions instantly, guide visitors to products or services, retrieve approved business information and hand complex issues to a human team.</p><p>For ecommerce businesses, a connected assistant can help with <strong>product discovery, order tracking, delivery questions and support tickets</strong>. For service businesses, it can answer from approved knowledge and query configured business resources. ZoChat is designed for both rather than being tied to one industry.</p></div></section>

      <section className="lp-section lp-faq" id="faq"><div className="lp-section-kicker">FREQUENTLY ASKED QUESTIONS</div><h2>Questions, answered.</h2><div className="lp-faq-list">{faqs.map(([q,a])=><details key={q}><summary>{q}<span>+</span></summary><p>{a}</p></details>)}</div></section>

      <section className="lp-final"><div className="lp-glow lp-glow-c"/><div className="lp-section-kicker">READY WHEN YOU ARE</div><h2>Turn your website into a<br/><em>24/7 support channel.</em></h2><p>Build an assistant around your business, your data and your rules.</p><button className="lp-primary" onClick={onLogin}>Create your ZoChat assistant <span>→</span></button></section>
    </main>
    <footer className="lp-footer"><a className="lp-logo" href="#top"><span>◆</span> ZoChat</a><p>AI customer service for modern businesses.</p><div><a href="#features">Features</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a><button onClick={onLogin}>Log in</button></div><small>© {new Date().getFullYear()} ZoChat. All rights reserved.</small></footer>
  </div>;
}
