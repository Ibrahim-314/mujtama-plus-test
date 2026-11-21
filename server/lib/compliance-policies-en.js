/* English versions of the Terms and Privacy documents (2.152.0). Same slugs, section ids and version as the Arabic
 * originals in compliance-policies.js; the Arabic text is the reference if the two ever differ. Deployment facts
 * (controller, contact, hosting, grace days) come from the same env-derived object so neither text claims more. */
const L = require("./compliance-lib");

const name = d => (d.controller === "مجتمع بلس" ? "Mujtama+" : d.controller);
const contactLine = d =>
  d.contact
    ? `Email us at ${d.contact}, or use "A request about my data" on the "My data & privacy" page.`
    : 'Use "A request about my data" on the "My data & privacy" page inside the app.';

const BASIS = { contract: "needed to provide the service", legal: "legal obligation", legitimate: "legitimate interest", consent: "your consent" };
const PURPOSE = {
  service: [
    "Providing the service and running your account",
    "Creating your account, showing your posts to the people you choose, messages, essential notifications."
  ],
  security: ["Protecting accounts and preventing abuse", "Sessions and devices, fraud and spam detection, the audit log."],
  moderation: ["Moderation and safety", "Reviewing reports, moderation decisions, appeals, the transparency report (aggregate numbers only)."],
  legal: ["Legal obligations", "Keeping what the law requires, answering lawful requests from competent authorities, the data-breach log."],
  personalization: [
    "Personalising your feed and suggestions",
    "Using your interactions and interests to order what you see. Without it your feed stays chronological and general."
  ],
  analytics: ["Usage statistics to improve the app", "Aggregated usage events, without message content or IP addresses."],
  marketing_email: ["Introductory emails and digests", "The weekly digest and news. You can turn them off at any time, free of charge."]
};

function terms(d, ar) {
  return {
    slug: "terms",
    title: "Terms of Use",
    version: ar.version,
    effective: ar.effective,
    summary: [
      "Mujtama+ is a place for respectful conversation. Post only what you have the right to post, and harm no one.",
      "Your content is yours. You only give us the permission needed to show it to the people you choose.",
      "We may hide content or restrict an account that breaks the guidelines; we tell you why, and you can appeal.",
      "You can download your data or delete your account at any time."
    ],
    sections: [
      {
        id: "who",
        heading: "Who we are",
        body: [`The service is run by "${name(d)}". By using the app you agree to these terms. If you do not agree, do not use the service.`]
      },
      {
        id: "account",
        heading: "Your account",
        body: [
          "You are responsible for your account and for keeping your password safe. Turn on two-step verification for better protection.",
          "Do not impersonate anyone, and do not create accounts to deceive others or manipulate engagement."
        ]
      },
      {
        id: "content",
        heading: "Your content",
        body: [
          "What you post stays yours. You grant us a non-exclusive, free licence to store, display and technically copy it only as far as needed to run the service, for the people you pick in your visibility settings.",
          "This licence ends when you delete the content or your account, except for copies others re-shared as quotes, or what the law requires us to keep."
        ]
      },
      {
        id: "rules",
        heading: "What we do not allow",
        body: [
          "Abuse, harassment and threats, hate speech, fraud and harmful links, publishing other people's personal data without permission, and any content that breaks applicable law.",
          "Details and examples are in the community guidelines, and every community can add its own rules set by its moderators."
        ]
      },
      {
        id: "moderation",
        heading: "How we enforce the rules",
        body: [
          "We rely on reports and on automated tools that can be wrong, so we prefer temporary hiding and human review over instant removal.",
          'When we take a decision about your content or account we send you the reason; you will find it in "My account decisions" with an appeal button.',
          "We publish a regular transparency report with aggregate numbers on reports, decisions and appeals."
        ]
      },
      {
        id: "pi",
        heading: "Pi and payments",
        body: [
          "Payments in Pi happen between your account and the Pi platform, and only with your approval in the official Pi window. We never hold your wallet keys or recovery phrase, and we will never ask you for them.",
          "You see the amount and the purpose before you confirm. A completed transaction on the Pi network cannot be reversed technically; if you are owed a refund inside the service, it is sent back to you as a new transaction.",
          "In test mode (Testnet) the app uses test Pi, which has no monetary value.",
          "Payments are not available to anyone under 18.",
          "Pi Network is independent from us, and your use of it is governed by its own terms and policies."
        ]
      },
      {
        id: "end",
        heading: "Ending your account",
        body: [
          `You can delete your account from "My data & privacy". Deletion runs after a ${d.grace}-day grace period during which you can change your mind.`,
          "We may suspend an account that seriously or repeatedly breaks these terms; we tell you why and you have the right to appeal."
        ]
      },
      {
        id: "liability",
        heading: "Limits of liability",
        body: [
          'We provide the service "as is" and work to keep it running and safe, but we cannot guarantee it is free of interruptions or errors. We are not responsible for what users post, and we take reports seriously.'
        ]
      },
      {
        id: "changes",
        heading: "Changes and governing law",
        body: [
          "If we change these terms in a material way, we tell you inside the app before the change takes effect.",
          "These terms are governed by the laws in force in the Kingdom of Saudi Arabia."
        ]
      },
      { id: "contact", heading: "Contact us", body: [contactLine(d)] }
    ]
  };
}

function privacy(d, ar) {
  const purposes = Object.entries(L.PURPOSES).map(([k, P]) => {
    const [label, descr] = PURPOSE[k] || [k, ""];
    return `• ${label} — basis: ${BASIS[P.basis] || P.basis}${P.required ? "" : " (you can withdraw it at any time)"}. ${descr}`;
  });
  return {
    slug: "privacy",
    title: "Privacy Policy",
    version: ar.version,
    effective: ar.effective,
    summary: [
      "We collect only what we need to run your account, and we do not sell your data.",
      "Your private messages are never used for ads or statistics, and we cannot read the encrypted ones.",
      "Personalisation, statistics and introductory emails need your consent, and you can turn them off with one tap.",
      "You have the right to see, copy, correct and delete your data, and we answer your request within 30 days."
    ],
    sections: [
      {
        id: "controller",
        heading: "Who is responsible for your data",
        body: [
          `The controller is "${name(d)}".${d.dpo ? ` Data protection officer: ${d.dpo}.` : ""} We comply with the Personal Data Protection Law of the Kingdom of Saudi Arabia and its implementing regulations.`
        ]
      },
      {
        id: "collect",
        heading: "What we collect",
        body: [
          "What you give us: your name, username, email (optional), bio and photos, and your posts, comments and messages.",
          "What your use produces: sessions, device type and IP address to protect your account, and your interactions to order your feed if you consent.",
          "We do not knowingly collect sensitive data about you (such as health or beliefs), and we ask for identity documents only for the optional verification request."
        ]
      },
      {
        id: "pi",
        heading: "Pi Network data",
        body: [
          "When you sign in with Pi or link your account to Pi, we receive from Pi Network, after your approval in the Pi window, only your Pi account identifier and username. The Pi access token is used for verification and is not stored.",
          "We never ask for or store your recovery phrase or wallet keys.",
          "When you pay, we keep a record of the transaction: the payment identifier, amount, purpose, status and the transaction id on the Pi network, to prove the payment and to handle refunds and disputes.",
          "Transactions on the Pi network are a public record run by Pi Network, which we cannot delete.",
          "When you delete your account, the Pi link is deleted, and financial transaction records are kept for as long as the law requires."
        ]
      },
      { id: "why", heading: "Why we use it", body: purposes },
      {
        id: "share",
        heading: "Who we share it with",
        body: [
          "We do not sell your data or share it with advertisers.",
          "We work with Pi Network for sign-in and payments only, and we do not send it your content or messages.",
          "We use technical service providers (hosting, email, push notifications) who process data on our behalf and only as far as needed.",
          "We may disclose data to competent authorities when the law requires it, and we log every disclosure."
        ]
      },
      {
        id: "where",
        heading: "Where it is stored",
        body: [
          d.hosting
            ? `Data is stored with our hosting provider in: ${d.hosting}.`
            : "Data is stored with a cloud hosting provider. If the storage location is outside the Kingdom, we apply the safeguards required by the regulation on transferring personal data outside the Kingdom.",
          "We protect data with encryption in transit, hashed passwords, and an audit log that cannot be altered without detection."
        ]
      },
      {
        id: "keep",
        heading: "How long we keep it",
        body: [
          'We keep each kind of data only as long as its purpose needs, then delete it or separate it from your identity automatically. The full table is on the "Data retention periods" page (in Arabic).'
        ]
      },
      {
        id: "rights",
        heading: "Your rights",
        body: [
          "• To be told how your data is processed (this page).",
          '• To see your data and get a copy in a readable format (JSON or ZIP) from "My data & privacy".',
          "• To correct your data from your profile settings, or ask us to correct what you cannot edit.",
          `• To ask for your account and data to be deleted; this runs after a ${d.grace}-day grace period to change your mind, then your personal data is erased and your identity is replaced with an anonymous name.`,
          "• To withdraw your consent to any optional purpose at any time, without affecting what came before.",
          "We answer your request within 30 days, which may be extended by another 30 days with the reason explained. You also have the right to complain to the competent Saudi data authority."
        ]
      },
      {
        id: "breach",
        heading: "If a data breach happens",
        body: [
          "We log every incident, notify the competent authority within 72 hours of learning about it when it could harm you, and tell you without undue delay."
        ]
      },
      {
        id: "children",
        heading: "Children",
        body: ["The service is not aimed at anyone under 13. If we learn that an account belongs to a child under this age, we suspend it."]
      },
      {
        id: "changes",
        heading: "Changes",
        body: ["We tell you inside the app before any material change, and we ask for your consent again if we add a purpose that relies on consent."]
      },
      { id: "contact", heading: "Contact us", body: [contactLine(d)] }
    ]
  };
}

module.exports = { terms, privacy };
