// Marathi — native Devanagari script, matching the vetted Marathi strings
// the backend already sends traders (backend/app/api/dashboard.py's
// _get_fix_action / _get_issue_label and webhook.py's onboarding flow).
//
// Convention, lifted from those backend strings: prose is Devanagari, but
// statutory/product acronyms stay in Latin exactly as a Marathi-speaking
// trader sees them on the GST portal and on the invoice itself — GST, GSTIN,
// HSN, ITC, GSTR-1/2B/3B, CMP-08, PDF, CA, WhatsApp. Numerals stay Latin too
// (backend does the same: "15 अक्षरे"), so they match the ₹ amounts this UI
// formats with the en-IN lakh/crore grouping.
const mr = {
  // Navigation
  nav_money_meter: "मनी मीटर",
  nav_supplier_trust: "सप्लायर विश्वास",
  nav_action_queue: "कृती यादी",
  nav_monthly_reports: "मासिक अहवाल",
  nav_my_profile: "माझे प्रोफाइल",
  nav_sign_out: "साइन आउट",
  nav_whatsapp_alerts: "WhatsApp अलर्ट",
  nav_send_test_alert: "टेस्ट अलर्ट पाठवा",
  nav_sending: "पाठवत आहे…",

  // Dashboard header
  hdr_composition: "कंपोझिशन",
  hdr_live: "लाइव्ह",
  hdr_switch_trader: "व्यापारी बदला",
  hdr_no_traders: "कोणताही व्यापारी सापडला नाही",

  // Money Meter cards
  mm_confirmed_itc: "निश्चित ITC",
  mm_at_risk: "धोक्यात / ब्लॉक",
  mm_potential_recovery: "संभाव्य वसुली",
  mm_this_month_live: "या महिन्यात · लाइव्ह",
  mm_requires_action: "18 तारखेपर्यंत कृती आवश्यक →",
  mm_fix_supplier: "ITC मिळवण्यासाठी सप्लायरच्या अडचणी दुरुस्त करा",
  mm_invoices_scanned: "स्कॅन केलेली इनव्हॉइस",
  mm_suppliers_tracked: "ट्रॅक केलेले सप्लायर",
  mm_open_issues: "उघड्या अडचणी",

  // Composition mode
  mm_total_sales: "एकूण विक्री",
  mm_est_tax: "अंदाजे कर (1%)",
  mm_cmp08: "CMP-08 स्थिती",
  mm_overdue: "मुदत उलटली",
  mm_due_soon: "लवकरच देय",
  mm_due_by_18th: "18 तारखेपर्यंत देय",
  mm_quarter_to_date: "तिमाहीपर्यंत",

  // Invoice feed
  inv_records: "इनव्हॉइस नोंदी",
  inv_live_sync: "लाइव्ह सिंक",
  inv_search: "सप्लायर, GSTIN, इनव्हॉइस शोधा…",
  inv_all_status: "सर्व स्थिती",
  inv_confirmed: "✓ निश्चित",
  inv_blocked: "⚠ ब्लॉक",
  inv_at_risk: "↯ धोक्यात",
  inv_fraud: "✕ फ्रॉड",
  inv_duplicate: "⧉ डुप्लिकेट",
  inv_resolved: "✓ सोडवले",
  inv_ineligible: "— अपात्र",
  inv_no_records: "कोणतीही नोंद सापडली नाही.",

  // Supplier Trust
  sup_risk_title: "सप्लायर धोका",
  sup_good_short: "चांगले",
  sup_at_risk_short: "धोक्यात",
  sup_blocked_short: "ब्लॉक",
  sup_needs_attention: "लक्ष द्या",
  sup_no_data_short: "अजून सप्लायर डेटा नाही.",
  sup_good_standing: "चांगली स्थिती",
  sup_at_risk: "धोक्यात",
  sup_blocked: "ब्लॉक",
  sup_search: "सप्लायर किंवा GSTIN शोधा…",
  sup_all_status: "सर्व स्थिती",
  sup_supplier: "सप्लायर",
  sup_gstin: "GSTIN",
  sup_health: "आरोग्य",
  sup_status: "स्थिती",
  act_days_left: "सप्लायरशी संपर्क करण्यासाठी {count} दिवस बाकी",
  act_due_today: "सप्लायरशी संपर्क करण्याचा आजचा शेवटचा दिवस",
  act_window_closed: "मुदत संपली",
  sup_itc: "ITC",
  sup_issues: "अडचणी",
  sup_action: "कृती",
  sup_view: "पहा",
  sup_fix: "दुरुस्त करा",
  sup_no_data: "अजून सप्लायर डेटा नाही. सुरू करण्यासाठी GSTR-2B अपलोड करा.",
  sup_no_filter: "तुमच्या फिल्टरशी कोणताही सप्लायर जुळत नाही.",
  sup_invoices: "इनव्हॉइस",
  sup_health_score: "आरोग्य स्कोअर",
  sup_open_issues: "उघड्या अडचणी",
  sup_no_invoices: "या सप्लायरसाठी कोणतेही इनव्हॉइस सापडले नाही",

  // Action Queue
  aq_all: "सर्व",
  aq_critical: "अतिगंभीर",
  aq_high: "जास्त",
  aq_medium: "मध्यम",
  aq_no_actions: "कोणतीही कृती आवश्यक नाही — उत्तम कम्प्लायन्स!",
  aq_resolve: "सोडवा",
  aq_resolved: "सोडवले",

  // Sidebar deadlines
  sb_upcoming_deadlines: "येणाऱ्या मुदती",
  sb_itc_trend: "ITC कल (6 महिने)",
  sb_wa_turn_on: "त्वरित कम्प्लायन्स स्मरणपत्रांसाठी चालू करा.",
  sb_wa_active: "तुम्हाला मुदत आणि मिसमॅच अलर्ट मिळतील.",

  // Reports
  rep_search: "कालावधी शोधा…",
  rep_period: "कालावधी",
  rep_itc_confirmed: "ITC निश्चित",
  rep_invoices: "इनव्हॉइस",
  rep_issues: "अडचणी",
  rep_pdf: "PDF",
  rep_download: "PDF डाउनलोड करा",
  rep_generating: "PDF तयार करत आहे…",
  rep_few_seconds: "यास काही सेकंद लागू शकतात.",
  rep_gstr2b_reports: "GSTR-2B अहवाल",
  rep_gstr2b_subtitle: "GST पोर्टलवरून अपलोड केलेल्या ऑटो-ड्राफ्ट ITC नोंदी",

  // Profile
  pro_my_profile: "माझे प्रोफाइल",
  pro_view_edit: "तुमचे CA तपशील पहा आणि बदला",
  pro_name: "नाव",
  pro_email: "ईमेल",
  pro_phone: "फोन",
  pro_save: "बदल सेव्ह करा",
  pro_saved: "सेव्ह झाले ✅",
  pro_portfolio: "पोर्टफोलिओ",
  pro_total_clients: "एकूण क्लायंट",
  pro_clients_with_issues: "अडचणी असलेले क्लायंट",
  pro_total_itc_at_risk: "एकूण ITC धोक्यात",

  // Filing readiness
  fr_gstr3b_readiness: "GSTR-3B तयारी",
  fr_invoices_processed: "इनव्हॉइसवर प्रक्रिया झाली",
  fr_issues_need_attention: "अडचणींकडे लक्ष देणे आवश्यक →",
  fr_upload_gstr2b: "GSTR-2B अपलोड करा",
  fr_json_excel: "GST पोर्टलवरून JSON / EXCEL",
  fr_drop_or_click: "GSTR-2B JSON/Excel इथे टाका · किंवा क्लिक करा",
  fr_upload_start: "सुरू करण्यासाठी GSTR-2B अपलोड करा",
  fr_ready_to_file: "फाईल करण्यासाठी तयार!",

  // --- Trader PWA (/trader) -------------------------------------------
  // Shell & drawer
  tr_active: "सक्रिय",
  tr_my_business: "माझा व्यवसाय",
  tr_language: "भाषा",
  tr_nav_dashboard: "डॅशबोर्ड",
  tr_nav_invoice_history: "इनव्हॉइस इतिहास",
  tr_nav_reports: "अहवाल आणि GSTR-2B",
  tr_log_out: "लॉग आउट",

  // Offline queue
  tr_checking_photo_quality: "तुमच्या फोनवर फोटोची गुणवत्ता तपासत आहे…",
  tr_queued_one: "1 इनव्हॉइस रांगेत आहे — ऑनलाइन होताच अपलोड होईल",
  tr_queued_many: "{count} इनव्हॉइस रांगेत आहेत — ऑनलाइन होताच अपलोड होतील",
  tr_queued_offline_title: "रांगेत — ऑफलाइन",
  tr_queued_offline_msg:
    "कनेक्शन नाही — इनव्हॉइस रांगेत ठेवली. ऑनलाइन होताच आपोआप अपलोड होईल.",
  tr_queued_slow_msg:
    "अपलोड वेळेत पूर्ण झाले नाही (कनेक्शन धीमे आहे का?) — इनव्हॉइस रांगेत आहे, आपोआप पुन्हा प्रयत्न होईल.",
  tr_queued_invoice_failed: "रांगेतील एका इनव्हॉइसवर प्रक्रिया होऊ शकली नाही.",

  // Scan result toast
  tr_processing_invoice: "इनव्हॉइसवर प्रक्रिया सुरू आहे…",
  tr_processing_checks: "GSTIN, HSN कोड आणि GSTR-2B जुळणी तपासत आहे",
  tr_invoice_analyzed: "इनव्हॉइस तपासली",
  tr_itc: "ITC",
  tr_narrated_on_device: "फोनवरच वाचून दाखवले",
  tr_hsn_match: "फोनवरील HSN जुळणी",
  tr_processing_failed_title: "प्रक्रिया अयशस्वी",
  tr_quota_reached: "API वापर मर्यादा संपली. उद्या पुन्हा प्रयत्न करा किंवा सपोर्टशी संपर्क साधा.",
  tr_invoice_processed: "इनव्हॉइसवर प्रक्रिया झाली!",
  tr_no_active_trader: "कोणताही सक्रिय व्यापारी नाही. आधी तुमचा GSTIN सेट करा.",
  tr_processing_failed_retry: "प्रक्रिया अयशस्वी. पुन्हा प्रयत्न करा.",
  tr_location_note: "तुम्ही नेहमी जिथे स्कॅन करता तिथून ~{km}km दूर स्कॅन झाली.",

  // ITC verdict status labels
  tr_status_confirmed: "निश्चित",
  tr_status_fixable_blocked: "ब्लॉक — दुरुस्त होऊ शकते",
  tr_status_at_risk: "धोक्यात",
  tr_status_missed: "ITC निसटले",
  tr_status_ineligible: "अपात्र",
  tr_status_fraud_flagged: "फ्रॉडचा संशय",
  tr_status_duplicate: "डुप्लिकेट",
  tr_status_processing: "प्रक्रिया सुरू",
  tr_status_pending: "प्रलंबित",

  // Home / history
  tr_financial_snapshot: "आर्थिक चित्र",
  tr_required_actions: "आवश्यक कृती",
  tr_invoice_history: "इनव्हॉइस इतिहास",
  tr_no_invoices_yet: "अजून कोणतीही इनव्हॉइस नाही. तुमची पहिली इनव्हॉइस स्कॅन करा!",
  tr_unknown_supplier: "अज्ञात सप्लायर",
  tr_history: "इतिहास",

  // Scan button + on-device photo check
  tr_checking_photo: "फोटो तपासत आहे…",
  tr_processing: "प्रक्रिया सुरू आहे…",
  tr_scan_invoice: "इनव्हॉइस स्कॅन करा",
  tr_photo_may_not_scan: "फोटो नीट स्कॅन होणार नाही",
  tr_retake_glare:
    "खूप चमक आहे — थेट प्रकाश किंवा फ्लॅश इनव्हॉइसवर पडू देऊ नका, मग पुन्हा फोटो काढा.",
  tr_retake_blur:
    "फोटो अस्पष्ट आहे — कॅमेरा स्थिर धरा आणि फोकस होऊ द्या, मग पुन्हा फोटो काढा.",
  tr_retake_photo: "पुन्हा फोटो काढा",
  tr_upload_anyway: "तरीही अपलोड करा",
  tr_checked_on_device: "तुमच्या फोनवरच तपासले — या तपासणीसाठी कोणताही डेटा अपलोड झाला नाही.",

  // --- Camera scanner (/trader/scanner) --------------------------------
  sc_align_invoice: "इनव्हॉइस चौकटीत ठेवा",
  sc_invoice_captured: "इनव्हॉइस कॅप्चर झाली",
  sc_extracted_synced: "Munim.ai ने माहिती काढून तुमच्या CA च्या डॅशबोर्डशी सिंक केली आहे.",
  sc_supplier: "सप्लायर",
  sc_amount: "रक्कम",
  sc_gstin: "GSTIN",
  sc_scan_another: "आणखी एक इनव्हॉइस स्कॅन करा",

  // Common
  loading: "लोड होत आहे…",
  error: "काहीतरी चूक झाली",
  close: "बंद करा",
  back: "मागे",
  next: "पुढे",
  prev: "मागील",
};

export default mr;
