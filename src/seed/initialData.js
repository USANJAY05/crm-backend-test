const initialLeads = [
  {
    id: 'L-101',
    name: 'Sarah Jenkins',
    phone: '+1 (555) 019-2834',
    email: 'sarah.j@gmail.com',
    amountRequested: 45000,
    score: 87,
    source: 'Website Form',
    status: 'In Progress',
    tags: ['High-Income', 'Pre-Qualified'],
    createdAt: '2026-07-01T10:30:00Z',
    notes: 'Looking for a home improvement loan. Excellent credit history.',
    financialInfo: {
      monthlyIncome: 8500,
      creditScore: 740,
      employer: 'TechCorp Solutions',
      debtToIncome: 0.28
    }
  },
  {
    id: 'L-102',
    name: 'Michael Chen',
    phone: '+1 (555) 014-9821',
    email: 'mchen.92@yahoo.com',
    amountRequested: 15000,
    score: 92,
    source: 'Facebook Ads',
    status: 'Qualified',
    tags: ['Auto Loan', 'Urgent'],
    createdAt: '2026-07-02T14:15:00Z',
    notes: 'Needs financing for a pre-owned Tesla. High down payment ready.',
    financialInfo: {
      monthlyIncome: 6200,
      creditScore: 780,
      employer: 'Stripe Inc',
      debtToIncome: 0.15
    }
  },
  {
    id: 'L-103',
    name: 'Amanda Ross',
    phone: '+1 (555) 017-3849',
    email: 'aross@outlook.com',
    amountRequested: 75000,
    score: 42,
    source: 'Direct Mail',
    status: 'New',
    tags: ['Debt Consolidate'],
    createdAt: '2026-07-05T09:00:00Z',
    notes: 'Requested credit consolidation loan. Existing heavy debt obligations.',
    financialInfo: {
      monthlyIncome: 4500,
      creditScore: 590,
      employer: 'Walmart Logistics',
      debtToIncome: 0.49
    }
  },
  {
    id: 'L-104',
    name: 'Robert Taylor',
    phone: '+1 (555) 012-7483',
    email: 'rtaylor@gmail.com',
    amountRequested: 25000,
    score: 75,
    source: 'Google Search',
    status: 'Qualified',
    tags: ['Personal Loan'],
    createdAt: '2026-07-06T11:45:00Z',
    notes: 'Personal loan for wedding expenses. Co-signer details available.',
    financialInfo: {
      monthlyIncome: 5800,
      creditScore: 680,
      employer: 'FedEx Express',
      debtToIncome: 0.31
    }
  },
  {
    id: 'L-105',
    name: 'Jessica Martinez',
    phone: '+1 (555) 015-4422',
    email: 'jess.martinez@gmail.com',
    amountRequested: 120000,
    score: 95,
    source: 'Partner Referral',
    status: 'In Progress',
    tags: ['Jumbo Loan', 'VIP'],
    createdAt: '2026-07-07T16:20:00Z',
    notes: 'Business expansion loan. Strong collateral presented.',
    financialInfo: {
      monthlyIncome: 14500,
      creditScore: 810,
      employer: 'Apex Medical Group',
      debtToIncome: 0.12
    }
  }
];

const initialWorkflows = [
  {
    id: 'W-001',
    name: 'Instant Personal Loan Qualifier',
    active: true,
    createdAt: '2026-06-15T08:00:00Z',
    nodes: [
      {
        id: 'node-1',
        type: 'trigger',
        label: 'New Lead Inbound',
        config: { triggerType: 'new_lead' },
        position: { x: 250, y: 50 }
      },
      {
        id: 'node-2',
        type: 'call',
        label: 'Automated AI Outbound Call',
        config: { prompt: 'You are ChiefXAI Assistant. Verify if the lead is interested in their requested loan amount and collect employer details.' },
        position: { x: 250, y: 180 }
      },
      {
        id: 'node-3',
        type: 'question',
        label: 'Lead Interest Level',
        config: {
          questionText: 'Is the customer interested in moving forward with the personal loan offer?',
          branches: [
            { condition: 'YES', targetId: 'node-4' },
            { condition: 'MAYBE', targetId: 'node-5' },
            { condition: 'NO', targetId: 'node-6' }
          ]
        },
        position: { x: 250, y: 310 }
      },
      {
        id: 'node-4',
        type: 'action',
        label: 'Assign to Senior Agent & OCR Doc Quest',
        config: { actionType: 'assign_agent', agentId: 'T-201', tagName: 'Hot Lead' },
        position: { x: 80, y: 460 }
      },
      {
        id: 'node-5',
        type: 'action',
        label: 'Schedule Call-back in 24 Hours',
        config: { actionType: 'schedule_callback' },
        position: { x: 250, y: 460 }
      },
      {
        id: 'node-6',
        type: 'action',
        label: 'Mark Unqualified & Close',
        config: { actionType: 'close_lead' },
        position: { x: 420, y: 460 }
      }
    ],
    edges: [
      { id: 'e1-2', source: 'node-1', target: 'node-2' },
      { id: 'e2-3', source: 'node-2', target: 'node-3' },
      { id: 'e3-4', source: 'node-3', target: 'node-4', label: 'YES' },
      { id: 'e3-5', source: 'node-3', target: 'node-5', label: 'MAYBE' },
      { id: 'e3-6', source: 'node-3', target: 'node-6', label: 'NO' }
    ]
  }
];

const initialCampaigns = [
  {
    id: 'C-001',
    name: 'Home Loan Retargeting',
    status: 'Running',
    workflowId: 'W-001',
    totalLeads: 48,
    calledLeads: 32,
    successfulCalls: 18,
    createdAt: '2026-07-08T08:00:00Z'
  },
  {
    id: 'C-002',
    name: 'Auto Refinance Outbound',
    status: 'Completed',
    workflowId: 'W-001',
    totalLeads: 120,
    calledLeads: 120,
    successfulCalls: 65,
    createdAt: '2026-06-20T09:30:00Z'
  },
  {
    id: 'C-003',
    name: 'Debt Consolidation Express',
    status: 'Paused',
    workflowId: 'W-001',
    totalLeads: 85,
    calledLeads: 14,
    successfulCalls: 5,
    createdAt: '2026-07-09T13:00:00Z'
  }
];

const initialCallLogs = [
  {
    id: 'CALL-501',
    leadId: 'L-101',
    leadName: 'Sarah Jenkins',
    campaignId: 'C-001',
    duration: 112,
    status: 'Completed',
    sentiment: 'Positive',
    intent: 'Interested',
    transcript: [
      { speaker: 'AI', text: 'Hello, am I speaking with Sarah Jenkins?', timestamp: '10:30:05' },
      { speaker: 'Customer', text: 'Yes, this is Sarah. Who is calling?', timestamp: '10:30:10' },
      { speaker: 'AI', text: 'Hi Sarah, I am the AI Loan Assistant from ChiefXAI. I saw you requested a $45,000 home improvement loan on our website. Is this a good time to verify a few details?', timestamp: '10:30:19' },
      { speaker: 'Customer', text: 'Oh yes! I am actually looking to start remodeling our kitchen next month. So yes, I have a few minutes.', timestamp: '10:30:30' },
      { speaker: 'AI', text: 'Perfect! That kitchen renovation sounds exciting. I see you listed TechCorp Solutions as your employer. Could you confirm your monthly income of around $8,500?', timestamp: '10:30:44' },
      { speaker: 'Customer', text: 'Yes, that is correct. My credit score should be quite good too, around 740.', timestamp: '10:30:52' },
      { speaker: 'AI', text: 'Fantastic! That matches our pre-qualification criteria. I am transferring your file to our senior loan manager, David, and sending you a secure link to upload your paystub and bank statements. Would you be able to upload those today?', timestamp: '10:31:08' },
      { speaker: 'Customer', text: 'Yes, I can upload those as soon as I get the email. Thank you!', timestamp: '10:31:15' },
      { speaker: 'AI', text: 'Wonderful, Sarah. David will reach out to you within two hours. Have a wonderful day!', timestamp: '10:31:22' },
      { speaker: 'Customer', text: 'Thanks, you too. Goodbye.', timestamp: '10:31:25' }
    ],
    summary: 'Customer confirmed interest in $45K home improvement loan. Verified employer (TechCorp) and income ($8,500). Credit self-reported at 740. Lead assigned to David and document upload link requested.',
    createdAt: '2026-07-09T10:30:00Z'
  },
  {
    id: 'CALL-502',
    leadId: 'L-103',
    leadName: 'Amanda Ross',
    campaignId: 'C-001',
    duration: 45,
    status: 'Completed',
    sentiment: 'Negative',
    intent: 'Not Interested',
    transcript: [
      { speaker: 'AI', text: 'Hello Amanda, I am calling from ChiefXAI regarding your request for debt consolidation.', timestamp: '14:20:05' },
      { speaker: 'Customer', text: 'I am really busy. I actually changed my mind and do not want another loan.', timestamp: '14:20:15' },
      { speaker: 'AI', text: 'I understand, Amanda. We want to make sure we do not bother you if things have changed. Is it alright if we close your file for now?', timestamp: '14:20:25' },
      { speaker: 'Customer', text: 'Yes, please close it and do not call again.', timestamp: '14:20:31' },
      { speaker: 'AI', text: 'No problem at all. Your profile has been deactivated. Thank you for your time.', timestamp: '14:20:40' }
    ],
    summary: 'Lead expressed immediate disinterest. Requested to close the file and stop outbound calls. Marked unqualified.',
    createdAt: '2026-07-09T14:20:00Z'
  }
];

const initialLoans = [
  {
    id: 'LN-201',
    leadId: 'L-101',
    leadName: 'Sarah Jenkins',
    amount: 45000,
    interestRate: 7.9,
    termMonths: 48,
    status: 'Verification',
    monthlyEmi: 1096.35,
    paidEmiCount: 0,
    totalEmiCount: 48,
    nextPaymentDate: '2026-08-15',
    documents: [
      {
        id: 'D-301',
        name: 'Sarah_Jenkins_W2_2025.pdf',
        type: 'ID Proof',
        status: 'Uploaded',
        fileSize: '1.2 MB'
      },
      {
        id: 'D-302',
        name: 'Sarah_Jenkins_Paystub_June.pdf',
        type: 'Paystub',
        status: 'Uploaded',
        fileSize: '840 KB'
      }
    ],
    history: [
      { status: 'Lead', updatedAt: '2026-07-01T10:30:00Z', note: 'Created from website form.', updatedBy: 'System' },
      { status: 'Application', updatedAt: '2026-07-09T10:32:00Z', note: 'AI call completed. Qualified. Application opened.', updatedBy: 'AI Agent' },
      { status: 'Verification', updatedAt: '2026-07-09T11:45:00Z', note: 'Documents uploaded by customer. Ready for AI OCR verification.', updatedBy: 'Sarah Jenkins' }
    ]
  },
  {
    id: 'LN-202',
    leadId: 'L-102',
    leadName: 'Michael Chen',
    amount: 15000,
    interestRate: 5.4,
    termMonths: 36,
    status: 'Repayment',
    monthlyEmi: 452.28,
    paidEmiCount: 3,
    totalEmiCount: 36,
    nextPaymentDate: '2026-07-25',
    documents: [
      { id: 'D-303', name: 'Michael_Chen_DL.pdf', type: 'ID Proof', status: 'Verified', fileSize: '2.1 MB' },
      { id: 'D-304', name: 'Stripe_Offer_Letter.pdf', type: 'Paystub', status: 'Verified', fileSize: '1.5 MB' }
    ],
    history: [
      { status: 'Lead', updatedAt: '2026-07-02T14:15:00Z', note: 'Inbound Facebook lead.', updatedBy: 'System' },
      { status: 'Approved', updatedAt: '2026-07-03T10:00:00Z', note: 'Auto-qualified based on high credit score.', updatedBy: 'Credit Committee' },
      { status: 'Disbursement', updatedAt: '2026-07-04T15:30:00Z', note: 'Funds wired to dealer invoice escrow account.', updatedBy: 'Treasury' },
      { status: 'Repayment', updatedAt: '2026-07-25T00:00:00Z', note: 'Active repayment initiated. Auto-pay configured.', updatedBy: 'System' }
    ]
  }
];

const initialVirtualNumbers = [
  {
    id: 'VN-401',
    number: '+1 (800) 555-8392',
    provider: 'Vobiz.ai',
    status: 'Active',
    friendlyName: 'AI Main Outbound Line',
    routingUrl: 'https://api.chiefxai.com/voice/inbound-main',
    incomingCallCount: 142,
    outgoingCallCount: 1240
  },
  {
    id: 'VN-402',
    number: '+1 (888) 555-2983',
    provider: 'Telnyx',
    status: 'Active',
    friendlyName: 'Collections Reminder Line',
    routingUrl: 'https://api.chiefxai.com/voice/collections-route',
    incomingCallCount: 35,
    outgoingCallCount: 450
  },
  {
    id: 'VN-403',
    number: '+1 (844) 555-1200',
    provider: 'SIP Trunk',
    status: 'Inactive',
    friendlyName: 'Backup Agent Hotline',
    routingUrl: 'https://api.chiefxai.com/voice/backup',
    incomingCallCount: 0,
    outgoingCallCount: 0
  },
  {
    id: 'VN-404',
    number: '+91 73580 21190',
    provider: 'Vobiz',
    status: 'Active',
    friendlyName: 'Vobiz AI Hotline',
    routingUrl: 'https://api.chiefxai.com/voice/vobiz-route',
    incomingCallCount: 88,
    outgoingCallCount: 920
  }
];

const initialTeamMembers = [
  {
    id: 'T-201',
    name: 'David Kael',
    email: 'david.kael@chiefxai.com',
    role: 'Sales Manager',
    status: 'Active',
    performanceScore: 94,
    assignedLeadsCount: 12
  },
  {
    id: 'T-202',
    name: 'Alicia Keyser',
    email: 'alicia.k@chiefxai.com',
    role: 'Loan Agent',
    status: 'Active',
    performanceScore: 88,
    assignedLeadsCount: 8
  },
  {
    id: 'T-203',
    name: 'Marcus Brody',
    email: 'marcus.b@chiefxai.com',
    role: 'Collection Agent',
    status: 'Active',
    performanceScore: 81,
    assignedLeadsCount: 15
  },
  {
    id: 'T-204',
    name: 'Evelyn Shaw',
    email: 'evelyn.s@chiefxai.com',
    role: 'AI Agent Manager',
    status: 'Active',
    performanceScore: 97,
    assignedLeadsCount: 0
  }
];

const initialOrgSettings = {
  id: 'org-1',
  name: 'Chief Capital LLC',
  workspaceName: 'chief-capital-us',
  subscriptionPlan: 'Growth',
  aiMinutesUsed: 2380,
  phoneCharges: 148.5,
  billingPeriodEnd: '2026-08-01',
  apiKeys: [
    { service: 'Gemini AI API', key: '••••••••••••••••3409', lastUsed: '2026-07-10T00:10:00Z' }
  ],
  taxId: '82-0495829',
  nmlsId: 'NMLS-994821',
  foundedYear: '2019',
  headquarters: '120 San Francisco St, Suite 400, San Francisco, CA 94103',
  website: 'https://chiefcapital.ai',
  contactEmail: 'contact@chiefcapital.ai',
  supportPhone: '+1 (800) 555-0199',
  complianceOfficer: 'Sarah Jenkins',
  regulatoryJurisdictions: ['California', 'Texas', 'Florida', 'New York'],
  businessType: 'LLC',
  primaryLendingSectors: ['Personal Loans', 'Mortgages', 'Auto Refinancing'],
  defaultInterestRate: 8.5,
  riskProfile: 'Moderate',
  companyBio: 'Chief Capital LLC is a premium technology-driven lending institution, delivering automated commercial and consumer financing solutions.',
  verificationStatus: 'Verified'
};

module.exports = {
  initialLeads,
  initialWorkflows,
  initialCampaigns,
  initialCallLogs,
  initialLoans,
  initialVirtualNumbers,
  initialTeamMembers,
  initialOrgSettings
};
