import type { Chatbot, KnowledgeItem, Order, Product, Tenant } from "./types.ts";

// ---------------------------------------------------------------------------
// First tenant: Ivy & Pearls (mock mode).
// In production these rows live in Supabase (tenants/chatbots/knowledge)
// and products/orders come from the real WooCommerce store.
// ---------------------------------------------------------------------------

export const IVY_PEARLS_TENANT: Tenant = {
  id: "t_ivy_pearls",
  slug: "ivy-pearls",
  kind: "retail",
  name: "Ivy & Pearls",
  storeUrl: "https://ivyandpearls.co.uk",
  currency: "GBP",
  welcomeMessage: "Hello, welcome to Ivy & Pearls! I can help you find the perfect piece, check an order, or answer questions about our jewellery.",
  tone: "Warm, elegant, helpful. British English. Never invent prices, stock levels or order statuses — use the tools.",
  brandColour: "#9c7b4f",
  supportEmail: "support@ivyandpearls.co.uk",
  ticketPrefix: "IP",
  businessContext:
    "Ivy & Pearls is a UK jewellery brand selling necklaces, earrings, bracelets, rings and gift sets in gold, silver and rose gold. " +
    "Shipping is free over £50 in the UK; standard delivery 2-4 working days. Prices are in GBP (£).",
  policy: {
    allowedTopics: [
      "products",
      "jewellery",
      "orders",
      "shipping",
      "returns",
      "payments",
      "sizing",
      "jewellery_care",
      "gifts",
      "store",
    ],
    refusalMessage:
      "I'm sorry, I can only help with Ivy & Pearls products, orders, delivery, returns and other services provided by Ivy & Pearls.",
    securityLevel: "extra-strict",
  },
};

export const IVY_PEARLS_CHATBOT: Chatbot = {
  id: "ivy-pearls",
  publicId: "cb_ivy_pearls",
  tenantId: "t_ivy_pearls",
  name: "Ivy & Pearls Assistant",
  active: true,
  permissions: ["read", "cart", "support", "sensitive"],
};

export const IVY_PEARLS_CATEGORIES = [
  { slug: "necklaces", name: "Necklaces" },
  { slug: "earrings", name: "Earrings" },
  { slug: "bracelets", name: "Bracelets" },
  { slug: "rings", name: "Rings" },
  { slug: "bridal", name: "Bridal" },
  { slug: "gift-sets", name: "Gift Sets" },
];

export const IVY_PEARLS_CATALOGUE: Product[] = [
  {
    id: 101,
    name: "Classic Gold Chain Necklace 18ct",
    price: 89.0,
    currency: "GBP",
    description: "A timeless 18ct gold-plated chain necklace. Lightweight and tarnish-resistant with everyday wear.",
    category: "Necklaces",
    url: "https://ivyandpearls.co.uk/product/classic-gold-chain-necklace",
    imageUrl: "https://placehold.co/400x400/f5ead6/9c7b4f?text=Gold+Chain",
    inStock: true,
    attributes: { colour: "gold", material: "18ct gold plate", waterproof: "No — remove before swimming", length: "45cm" },
    variants: [
      { id: "101-45", name: "Gold / 45cm", inStock: true, attributes: { colour: "gold", length: "45cm" } },
      { id: "101-50", name: "Gold / 50cm", price: 95.0, inStock: true, attributes: { colour: "gold", length: "50cm" } },
    ],
  },
  {
    id: 102,
    name: "Pearl Drop Necklace",
    price: 74.5,
    currency: "GBP",
    description: "Freshwater pearl pendant on a delicate gold chain. A graceful gift for any occasion.",
    category: "Necklaces",
    url: "https://ivyandpearls.co.uk/product/pearl-drop-necklace",
    imageUrl: "https://placehold.co/400x400/f5ead6/9c7b4f?text=Pearl+Drop",
    inStock: true,
    attributes: { colour: "gold", material: "sterling silver, freshwater pearl", waterproof: "No" },
  },
  {
    id: 103,
    name: "Gold Hoop Earrings 14ct",
    price: 45.0,
    currency: "GBP",
    description: "Everyday gold hoop earrings, 14ct gold plated over sterling silver. Comfortable for all-day wear.",
    category: "Earrings",
    url: "https://ivyandpearls.co.uk/product/gold-hoop-earrings",
    imageUrl: "https://placehold.co/400x400/f5ead6/9c7b4f?text=Gold+Hoops",
    inStock: true,
    attributes: { colour: "gold", material: "14ct gold plate over sterling silver", waterproof: "No", hypoallergenic: "Yes" },
    variants: [
      { id: "103-s", name: "Gold / Small (12mm)", price: 39.0, inStock: true, attributes: { colour: "gold", size: "12mm" } },
      { id: "103-m", name: "Gold / Medium (20mm)", inStock: true, attributes: { colour: "gold", size: "20mm" } },
      { id: "103-l", name: "Gold / Large (28mm)", price: 52.0, inStock: false, attributes: { colour: "gold", size: "28mm" } },
    ],
  },
  {
    id: 104,
    name: "Silver Bar Bracelet",
    price: 59.0,
    currency: "GBP",
    description: "Minimal sterling silver bangle with a polished bar detail. Stackable and understated.",
    category: "Bracelets",
    url: "https://ivyandpearls.co.uk/product/silver-bar-bracelet",
    imageUrl: "https://placehold.co/400x400/e8e8e8/7d7d7d?text=Silver+Bar",
    inStock: true,
    attributes: { colour: "silver", material: "sterling silver", waterproof: "No" },
  },
  {
    id: 105,
    name: "Rose Gold Pendant Necklace",
    price: 95.0,
    currency: "GBP",
    description: "Rose gold plated pendant with cubic zirconia accent. A romantic statement piece.",
    category: "Necklaces",
    url: "https://ivyandpearls.co.uk/product/rose-gold-pendant-necklace",
    imageUrl: "https://placehold.co/400x400/f5ded6/b08a6d?text=Rose+Gold",
    inStock: true,
    attributes: { colour: "rose gold", material: "rose gold plate", waterproof: "No", stones: "cubic zirconia" },
  },
  {
    id: 106,
    name: "Gemstone Stud Earrings Set",
    price: 38.0,
    currency: "GBP",
    description: "Three pairs of gemstone studs — amethyst, emerald and topaz. Screw-back posts.",
    category: "Earrings",
    url: "https://ivyandpearls.co.uk/product/gemstone-stud-earrings-set",
    imageUrl: "https://placehold.co/400x400/e8e8e8/7d7d7d?text=Studs",
    inStock: true,
    attributes: { colour: "mixed", material: "sterling silver, natural gemstones", waterproof: "No" },
  },
  {
    id: 107,
    name: "Anniversary Gift Box",
    price: 129.0,
    currency: "GBP",
    description: "Curated gift box: pearl drop necklace, matching earrings and a hand-written note card. Gift wrapped.",
    category: "Gift Sets",
    url: "https://ivyandpearls.co.uk/product/anniversary-gift-box",
    imageUrl: "https://placehold.co/400x400/f5ead6/9c7b4f?text=Gift+Box",
    inStock: true,
    attributes: { colour: "gold", material: "assorted", gift_wrapped: "Yes" },
  },
  {
    id: 108,
    name: "Gold Plated Hoop Earrings Small",
    price: 29.0,
    currency: "GBP",
    description: "Small gold hoops at an entry price point. Great first piece or stocking filler.",
    category: "Earrings",
    url: "https://ivyandpearls.co.uk/product/gold-plated-hoop-earrings-small",
    imageUrl: "https://placehold.co/400x400/f5ead6/9c7b4f?text=Small+Hoops",
    inStock: true,
    attributes: { colour: "gold", material: "gold plated", waterproof: "No" },
  },
  {
    id: 109,
    name: "Bridal Pearl Earrings",
    price: 65.0,
    currency: "GBP",
    description: "Freshwater pearl drop earrings, classic bridal style. Hypoallergenic posts.",
    category: "Bridal",
    url: "https://ivyandpearls.co.uk/product/bridal-pearl-earrings",
    imageUrl: "https://placehold.co/400x400/f5ead6/9c7b4f?text=Bridal+Pearls",
    inStock: false,
    attributes: { colour: "silver", material: "sterling silver, freshwater pearl", hypoallergenic: "Yes" },
  },
  {
    id: 110,
    name: "Silver Curb Chain Necklace",
    price: 52.0,
    currency: "GBP",
    description: "Sterling silver curb chain, 50cm. A modern everyday staple.",
    category: "Necklaces",
    url: "https://ivyandpearls.co.uk/product/silver-curb-chain-necklace",
    imageUrl: "https://placehold.co/400x400/e8e8e8/7d7d7d?text=Curb+Chain",
    inStock: true,
    attributes: { colour: "silver", material: "sterling silver", waterproof: "No", length: "50cm" },
  },
  {
    id: 111,
    name: "Gold Signet Ring",
    price: 79.0,
    currency: "GBP",
    description: "Bold gold signet ring, unisex fit. Sold in UK sizes I–T.",
    category: "Rings",
    url: "https://ivyandpearls.co.uk/product/gold-signet-ring",
    imageUrl: "https://placehold.co/400x400/f5ead6/9c7b4f?text=Signet",
    inStock: true,
    attributes: { colour: "gold", material: "gold plated over sterling silver", waterproof: "No" },
    variants: [
      { id: "111-i", name: "Size I", inStock: true, attributes: { size: "I" } },
      { id: "111-m", name: "Size M", inStock: true, attributes: { size: "M" } },
      { id: "111-p", name: "Size P", inStock: false, attributes: { size: "P" } },
      { id: "111-t", name: "Size T", inStock: true, attributes: { size: "T" } },
    ],
  },
  {
    id: 112,
    name: "Minimal Silver Stud Earrings",
    price: 24.0,
    currency: "GBP",
    description: "Tiny sterling silver studs, hypoallergenic. The everyday pair you never take off.",
    category: "Earrings",
    url: "https://ivyandpearls.co.uk/product/minimal-silver-stud-earrings",
    imageUrl: "https://placehold.co/400x400/e8e8e8/7d7d7d?text=Silver+Studs",
    inStock: true,
    attributes: { colour: "silver", material: "sterling silver", hypoallergenic: "Yes", waterproof: "No" },
  },
];

export const IVY_PEARLS_ORDERS: Order[] = [
  {
    id: "4821",
    customerEmail: "customer@example.com",
    status: "shipped",
    total: 74.5,
    currency: "GBP",
    items: [{ name: "Pearl Drop Necklace", qty: 1 }],
    date: "2026-08-02T10:24:00Z",
  },
  {
    id: "314",
    customerEmail: "test@test.com",
    status: "processing",
    total: 96.0,
    currency: "GBP",
    items: [{ name: "Rose Gold Pendant Necklace", qty: 1 }],
    date: "2026-08-08T12:30:00Z",
  },
  {
    id: "4756",
    customerEmail: "customer@example.com",
    status: "processing",
    total: 45.0,
    currency: "GBP",
    items: [{ name: "Gold Hoop Earrings 14ct", qty: 1 }],
    date: "2026-08-06T15:02:00Z",
  },
  {
    id: "4633",
    customerEmail: "another@example.com",
    status: "delivered",
    total: 129.0,
    currency: "GBP",
    items: [{ name: "Anniversary Gift Box", qty: 1 }],
    date: "2026-07-21T09:15:00Z",
  },
];

export const IVY_PEARLS_KNOWLEDGE: KnowledgeItem[] = [
  {
    id: "k1",
    chatbotId: "ivy-pearls",
    title: "Are your necklaces waterproof?",
    content:
      "None of our jewellery is fully waterproof. We recommend removing pieces before swimming, showering, exercising or sleeping. " +
      "Prolonged contact with water, perfume and chemicals can tarnish gold plate and silver.",
    keywords: ["waterproof", "water", "swimming", "shower", "tarnish", "care"],
  },
  {
    id: "k2",
    chatbotId: "ivy-pearls",
    title: "Shipping and delivery times",
    content:
      "Standard UK delivery takes 2-4 working days and is free on orders over £50. Express next-day delivery is £6.95 if ordered before 2pm. " +
      "International delivery takes 5-10 working days.",
    keywords: ["shipping", "delivery", "dispatch", "how long", "tracking", "free delivery"],
  },
  {
    id: "k3",
    chatbotId: "ivy-pearls",
    title: "Returns and exchanges",
    content:
      "You have 30 days from delivery to return any unworn item in its original packaging for a full refund or exchange. " +
      "Personalised items are non-returnable unless faulty. Start a return from your account or contact support@ivyandpearls.co.uk.",
    keywords: ["return", "refund", "exchange", "30 days", "unworn", "personalised"],
  },
  {
    id: "k4",
    chatbotId: "ivy-pearls",
    title: "Jewellery care guide",
    content:
      "Store pieces separately in the pouch provided, avoid perfume and lotions touching the metal, and polish gently with a soft cloth. " +
      "Silver will naturally tarnish over time — a silver cloth restores the shine.",
    keywords: ["care", "clean", "polish", "tarnish", "storage", "maintenance"],
  },
  {
    id: "k5",
    chatbotId: "ivy-pearls",
    title: "Materials and hypoallergenic options",
    content:
      "Our everyday ranges are 14ct or 18ct gold plate over sterling silver. Pearl pieces use freshwater pearls. " +
      "Sterling silver pieces marked hypoallergenic are nickel-free and suitable for sensitive skin.",
    keywords: ["material", "hypoallergenic", "nickel", "sensitive skin", "gold plated", "sterling"],
  },
  {
    id: "k6",
    chatbotId: "ivy-pearls",
    title: "Gift wrapping",
    content:
      "Every order is gift wrapped in our signature box with ribbon at no extra cost. Add a hand-written note at checkout and we'll include it.",
    keywords: ["gift", "wrap", "wrapping", "note", "card", "present"],
  },
  {
    id: "k7",
    chatbotId: "ivy-pearls",
    title: "Payment methods",
    content:
      "We accept all major debit and credit cards, PayPal, Apple Pay and Google Pay. Orders are charged in GBP. " +
      "We never store your card details — payments are processed securely by Stripe.",
    keywords: ["payment", "pay", "card", "apple pay", "google pay", "paypal", "debit", "credit", "stripe"],
  },
  {
    id: "k8",
    chatbotId: "ivy-pearls",
    title: "Do you deliver to Scotland?",
    content:
      "Yes — we deliver across the whole of the UK, including the Scottish Highlands and islands. Standard delivery is 2-4 working days " +
      "and free over £50; remote postcodes may take up to 5 working days.",
    keywords: ["scotland", "highlands", "islands", "remote", "uk delivery"],
  },
  {
    id: "k9",
    chatbotId: "ivy-pearls",
    title: "Sizing and fitting",
    content:
      "Necklaces come in 45cm (choker) and 50cm (princess) lengths unless stated. Bracelets fit a 16-17cm wrist. Rings are UK sizes I–T; " +
      "use a ring sizer or contact us and we'll help you find the right fit.",
    keywords: ["size", "sizing", "length", "fit", "wrist", "ring size", "measure"],
  },
  {
    id: "k10",
    chatbotId: "ivy-pearls",
    title: "Store information and contact",
    content:
      "Ivy & Pearls is an online-only UK jewellery brand. Customer care is available Monday–Friday, 9am–5pm UK time at " +
      "support@ivyandpearls.co.uk. We usually reply within one working day.",
    keywords: ["contact", "email", "phone", "hours", "support", "about", "store"],
  },
];

// ---------------------------------------------------------------------------
// Second tenant: NTM Associates Ltd (accountancy — live on the NTM site).
// ---------------------------------------------------------------------------

export const NTM_ASSOCIATES_TENANT: Tenant = {
  id: "t_ntm_associates",
  slug: "ntm-associates",
  kind: "services",
  name: "NTM Associates Ltd",
  storeUrl: "https://ntmassociatesltd.co.uk",
  currency: "GBP",
  welcomeMessage:
    "Hello, welcome to NTM Associates! I can help with questions about our accountancy services — bookkeeping, tax, payroll, VAT and company accounts. How can I help?",
  tone: "Professional, friendly and jargon-free. British English. Never invent fees, deadlines or tax figures — use the knowledge base and refer clients to the contact page for a quote.",
  brandColour: "#4c1d95",
  supportEmail: "contact@ntmassociatesltd.co.uk",
  ticketPrefix: "NTM",
  businessContext:
    "NTM Associates Ltd is a UK accountancy firm based in Rochdale, serving clients UK-wide remotely. Services: bookkeeping, accounting & tax, payroll, VAT returns, company accounts and business support. Clients include sole traders, contractors, landlords and limited companies.",
  policy: {
    allowedTopics: ["accounting", "bookkeeping", "tax_services", "payroll", "business_services"],
    refusalMessage:
      "I'm sorry, I can only help with NTM Associates accountancy services — bookkeeping, tax, payroll, VAT and company accounts.",
    securityLevel: "strict",
  },
};

export const NTM_ASSOCIATES_CHATBOT: Chatbot = {
  id: "ntm-associates",
  publicId: "cb_ntm_associates",
  tenantId: "t_ntm_associates",
  name: "NTM Associates Assistant",
  active: true,
  permissions: ["read", "support"],
};

export const NTM_ASSOCIATES_KNOWLEDGE: KnowledgeItem[] = [
  {
    id: "n1",
    chatbotId: "ntm-associates",
    title: "Services overview",
    content:
      "NTM Associates Ltd provides bookkeeping, accounting and tax, payroll, VAT returns, company accounts and business support — everything a small business, contractor, landlord or limited company needs to stay compliant and tax-efficient.",
    keywords: ["services", "what do you do", "offer", "accountant", "support", "help"],
  },
  {
    id: "n2",
    chatbotId: "ntm-associates",
    title: "Bookkeeping services",
    content:
      "Monthly bookkeeping with bank and credit card reconciliation, sales and purchase ledger management, expense and receipt capture, monthly management reports (P&L and balance sheet), cloud software setup (Xero, QuickBooks) and HMRC-ready records.",
    keywords: ["bookkeeping", "books", "xero", "quickbooks", "reconciliation", "ledger"],
  },
  {
    id: "n3",
    chatbotId: "ntm-associates",
    title: "Accounting and tax",
    content:
      "Self-assessment tax returns, personal tax planning, tax payment planning, HMRC correspondence handled on your behalf, capital allowances and reliefs, and year-end accounts preparation. Paper returns due 31 October; online returns due 31 January.",
    keywords: ["tax", "self-assessment", "accounting", "hmrc", "returns", "deadline", "31 january", "31 jan"],
  },
  {
    id: "n4",
    chatbotId: "ntm-associates",
    title: "Payroll services",
    content:
      "Weekly or monthly payroll runs, RTI submissions to HMRC on pay day, payslips and P60s, auto-enrolment pension management, starter and leaver reporting (P45/P46) and statutory payments such as SSP, SMP, SPP and ShPP.",
    keywords: ["payroll", "rti", "payslip", "p60", "pension", "auto-enrolment", "employees", "ssp", "smp"],
  },
  {
    id: "n5",
    chatbotId: "ntm-associates",
    title: "VAT returns and MTD",
    content:
      "Quarterly VAT return filing through MTD-compliant software, VAT registration advice (compulsory when taxable turnover exceeds £90,000 in a rolling 12 months), Flat Rate and cash accounting schemes, VAT on property, and representation at HMRC inspections.",
    keywords: ["vat", "mtd", "making tax digital", "registration", "90000", "90,000", "flat rate", "returns"],
  },
  {
    id: "n6",
    chatbotId: "ntm-associates",
    title: "Company accounts and incorporation",
    content:
      "Statutory accounts prepared to Companies House and HMRC standards, corporation tax CT600 filing, Companies House annual filing and confirmation statements, plus help incorporating a limited company and registering for VAT, PAYE and Self Assessment.",
    keywords: ["company accounts", "limited company", "ct600", "corporation tax", "companies house", "incorporation", "confirmation statement"],
  },
  {
    id: "n7",
    chatbotId: "ntm-associates",
    title: "Who NTM works with",
    content:
      "Sole traders, freelancers, contractors, landlords, start-ups and limited companies across the UK — from one-person businesses to established companies with employees. Work is done remotely using cloud accounting software and video calls.",
    keywords: ["clients", "who", "sole trader", "contractor", "landlord", "freelancer", "startup", "uk-wide", "remote"],
  },
  {
    id: "n8",
    chatbotId: "ntm-associates",
    title: "Fees and quotes",
    content:
      "NTM offers clear, fixed-fee pricing tailored to the client's needs — no hidden charges. The cost depends on the services required and the size of the business. Contact the team for a free, no-obligation quote.",
    keywords: ["price", "pricing", "fees", "cost", "how much", "quote", "charges", "fixed fee"],
  },
  {
    id: "n9",
    chatbotId: "ntm-associates",
    title: "Contact details and hours",
    content:
      "Email contact@ntmassociatesltd.co.uk or call 07340 647332. Office hours are Monday to Friday, 9:00–18:00. Registered office: Unit 11, Alma Industrial Estate, Regent Street, Rochdale, OL12 0HQ. Company number 05827364. Most queries are answered within one working day.",
    keywords: ["contact", "email", "phone", "call", "hours", "address", "rochdale", "company number", "07340", "647332"],
  },
  {
    id: "n10",
    chatbotId: "ntm-associates",
    title: "Confidentiality",
    content:
      "All client information is handled with full confidentiality and in line with data protection requirements. Records are stored securely and never shared without authorisation.",
    keywords: ["confidential", "private", "data protection", "secure", "gdpr", "safe"],
  },
];
