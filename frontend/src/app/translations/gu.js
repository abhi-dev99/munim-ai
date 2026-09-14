// Gujarati — native Gujarati script, matching the vetted Gujarati strings the
// backend already sends traders (backend/app/api/dashboard.py's
// _get_fix_action / _get_issue_label, webhook.py's onboarding flow and
// auth.py's OTP message). Vocabulary is lifted from those strings on purpose
// so a trader reads the same words on WhatsApp and in the app: સપ્લાયર,
// ઇન્વૉઇસ, જોખમમાં, સુધારો, તપાસો, ફ્રોડ, ક્લેમ.
//
// Convention, identical to mr.js: prose is Gujarati script, but statutory and
// product acronyms stay in Latin exactly as a Gujarati-speaking trader sees
// them on the GST portal and on the invoice itself — GST, GSTIN, HSN, ITC,
// GSTR-1/2B/3B, CMP-08, PDF, API, CA, WhatsApp, Munim.ai. Numerals stay Latin
// too (the backend does the same: "15 અક્ષરો"), so they match the ₹ amounts
// this UI formats with the en-IN lakh/crore grouping. No Gujarati *word* is
// ever spelled in Latin transliteration.
const gu = {
  // Navigation
  nav_money_meter: "મની મીટર",
  nav_supplier_trust: "સપ્લાયર વિશ્વાસ",
  nav_action_queue: "કાર્ય યાદી",
  nav_monthly_reports: "માસિક અહેવાલ",
  nav_my_profile: "મારી પ્રોફાઇલ",
  nav_sign_out: "સાઇન આઉટ",
  nav_whatsapp_alerts: "WhatsApp અલર્ટ",
  nav_send_test_alert: "ટેસ્ટ અલર્ટ મોકલો",
  nav_sending: "મોકલી રહ્યા છીએ…",

  // Dashboard header
  hdr_composition: "કમ્પોઝિશન",
  hdr_live: "લાઇવ",
  hdr_switch_trader: "વેપારી બદલો",
  hdr_no_traders: "કોઈ વેપારી મળ્યો નથી",

  // Money Meter cards
  mm_confirmed_itc: "નિશ્ચિત ITC",
  mm_at_risk: "જોખમમાં / બ્લોક",
  mm_potential_recovery: "સંભવિત વસૂલાત",
  mm_this_month_live: "આ મહિને · લાઇવ",
  mm_requires_action: "18 તારીખ સુધીમાં કાર્યવાહી જરૂરી →",
  mm_fix_supplier: "ITC મેળવવા સપ્લાયરની સમસ્યાઓ સુધારો",
  mm_invoices_scanned: "સ્કેન કરેલા ઇન્વૉઇસ",
  mm_suppliers_tracked: "ટ્રેક કરેલા સપ્લાયર",
  mm_open_issues: "ખુલ્લી સમસ્યાઓ",

  // Composition mode
  mm_total_sales: "કુલ વેચાણ",
  mm_est_tax: "અંદાજિત ટેક્સ (1%)",
  mm_cmp08: "CMP-08 સ્થિતિ",
  mm_overdue: "મુદત વીતી ગઈ",
  mm_due_soon: "જલદી દેય",
  mm_due_by_18th: "18 તારીખ સુધીમાં દેય",
  mm_quarter_to_date: "ત્રિમાસિક અત્યાર સુધી",

  // Invoice feed
  inv_records: "ઇન્વૉઇસ નોંધ",
  inv_live_sync: "લાઇવ સિંક",
  inv_search: "સપ્લાયર, GSTIN, ઇન્વૉઇસ શોધો…",
  inv_all_status: "બધી સ્થિતિ",
  inv_confirmed: "✓ નિશ્ચિત",
  inv_blocked: "⚠ બ્લોક",
  inv_at_risk: "↯ જોખમમાં",
  inv_fraud: "✕ ફ્રોડ",
  inv_duplicate: "⧉ ડુપ્લિકેટ",
  inv_resolved: "✓ ઉકેલાયું",
  inv_ineligible: "— અપાત્ર",
  inv_no_records: "કોઈ નોંધ મળી નથી.",

  // Supplier Trust
  sup_risk_title: "સપ્લાયર જોખમ",
  sup_good_short: "સારું",
  sup_at_risk_short: "જોખમમાં",
  sup_blocked_short: "બ્લોક",
  sup_needs_attention: "ધ્યાન આપો",
  sup_no_data_short: "હજી સપ્લાયર ડેટા નથી.",
  sup_good_standing: "સારી સ્થિતિ",
  sup_at_risk: "જોખમમાં",
  sup_blocked: "બ્લોક",
  sup_search: "સપ્લાયર અથવા GSTIN શોધો…",
  sup_all_status: "બધી સ્થિતિ",
  sup_supplier: "સપ્લાયર",
  sup_gstin: "GSTIN",
  sup_health: "આરોગ્ય",
  sup_status: "સ્થિતિ",
  act_days_left: "સપ્લાયરનો સંપર્ક કરવા {count} દિવસ બાકી",
  act_due_today: "સપ્લાયરનો સંપર્ક કરવાનો આજે છેલ્લો દિવસ",
  act_window_closed: "સમય પૂરો થયો",
  sup_itc: "ITC",
  sup_issues: "સમસ્યાઓ",
  sup_action: "કાર્યવાહી",
  sup_view: "જુઓ",
  sup_fix: "સુધારો",
  sup_no_data: "હજી સપ્લાયર ડેટા નથી. શરૂ કરવા GSTR-2B અપલોડ કરો.",
  sup_no_filter: "તમારા ફિલ્ટર સાથે કોઈ સપ્લાયર મેચ થતો નથી.",
  sup_invoices: "ઇન્વૉઇસ",
  sup_health_score: "આરોગ્ય સ્કોર",
  sup_open_issues: "ખુલ્લી સમસ્યાઓ",
  sup_no_invoices: "આ સપ્લાયર માટે કોઈ ઇન્વૉઇસ મળ્યું નથી",

  // Action Queue
  aq_all: "બધા",
  aq_critical: "અતિગંભીર",
  aq_high: "વધુ",
  aq_medium: "મધ્યમ",
  aq_no_actions: "કોઈ કાર્યવાહી જરૂરી નથી — ઉત્તમ કમ્પ્લાયન્સ!",
  aq_resolve: "ઉકેલો",
  aq_resolved: "ઉકેલાયું",

  // Sidebar deadlines
  sb_upcoming_deadlines: "આવનારી મુદતો",
  sb_itc_trend: "ITC વલણ (6 મહિના)",
  sb_wa_turn_on: "તાત્કાલિક કમ્પ્લાયન્સ રિમાઇન્ડર માટે ચાલુ કરો.",
  sb_wa_active: "તમને મુદત અને મિસમેચ અલર્ટ મળશે.",

  // Reports
  rep_search: "સમયગાળો શોધો…",
  rep_period: "સમયગાળો",
  rep_itc_confirmed: "ITC નિશ્ચિત",
  rep_invoices: "ઇન્વૉઇસ",
  rep_issues: "સમસ્યાઓ",
  rep_pdf: "PDF",
  rep_download: "PDF ડાઉનલોડ કરો",
  rep_generating: "PDF તૈયાર કરી રહ્યા છીએ…",
  rep_few_seconds: "આમાં થોડી સેકન્ડ લાગી શકે છે.",
  rep_gstr2b_reports: "GSTR-2B અહેવાલ",
  rep_gstr2b_subtitle: "GST પોર્ટલ પરથી અપલોડ કરેલી ઓટો-ડ્રાફ્ટ ITC નોંધ",

  // Profile
  pro_my_profile: "મારી પ્રોફાઇલ",
  pro_view_edit: "તમારી CA વિગતો જુઓ અને બદલો",
  pro_name: "નામ",
  pro_email: "ઈમેલ",
  pro_phone: "ફોન",
  pro_save: "ફેરફાર સેવ કરો",
  pro_saved: "સેવ થઈ ગયું ✅",
  pro_portfolio: "પોર્ટફોલિયો",
  pro_total_clients: "કુલ ક્લાયન્ટ",
  pro_clients_with_issues: "સમસ્યાવાળા ક્લાયન્ટ",
  pro_total_itc_at_risk: "કુલ ITC જોખમમાં",

  // Filing readiness
  fr_gstr3b_readiness: "GSTR-3B તૈયારી",
  fr_invoices_processed: "ઇન્વૉઇસ પર પ્રક્રિયા થઈ",
  fr_issues_need_attention: "સમસ્યાઓ પર ધ્યાન આપવું જરૂરી →",
  fr_upload_gstr2b: "GSTR-2B અપલોડ કરો",
  fr_json_excel: "GST પોર્ટલ પરથી JSON / EXCEL",
  fr_drop_or_click: "GSTR-2B JSON/Excel અહીં મૂકો · અથવા ક્લિક કરો",
  fr_upload_start: "શરૂ કરવા GSTR-2B અપલોડ કરો",
  fr_ready_to_file: "ફાઇલ કરવા તૈયાર!",

  // --- Trader PWA (/trader) -------------------------------------------
  // Shell & drawer
  tr_active: "સક્રિય",
  tr_my_business: "મારો વ્યવસાય",
  tr_language: "ભાષા",
  tr_nav_dashboard: "ડેશબોર્ડ",
  tr_nav_invoice_history: "ઇન્વૉઇસ ઇતિહાસ",
  tr_nav_reports: "અહેવાલ અને GSTR-2B",
  tr_log_out: "લોગ આઉટ",

  // Offline queue
  tr_checking_photo_quality: "તમારા ફોન પર ફોટોની ગુણવત્તા તપાસી રહ્યા છીએ…",
  tr_queued_one: "1 ઇન્વૉઇસ કતારમાં છે — ઓનલાઇન થતાં જ અપલોડ થશે",
  tr_queued_many: "{count} ઇન્વૉઇસ કતારમાં છે — ઓનલાઇન થતાં જ અપલોડ થશે",
  tr_queued_offline_title: "કતારમાં — ઓફલાઇન",
  tr_queued_offline_msg:
    "કનેક્શન નથી — ઇન્વૉઇસ કતારમાં મૂક્યું. ઓનલાઇન થતાં જ આપોઆપ અપલોડ થશે.",
  tr_queued_slow_msg:
    "અપલોડ સમયસર પૂરું થયું નથી (કનેક્શન ધીમું છે?) — ઇન્વૉઇસ કતારમાં છે, આપોઆપ ફરી પ્રયાસ થશે.",
  tr_queued_invoice_failed: "કતારમાંના એક ઇન્વૉઇસ પર પ્રક્રિયા થઈ શકી નથી.",

  // Scan result toast
  tr_processing_invoice: "ઇન્વૉઇસ પર પ્રક્રિયા ચાલુ છે…",
  tr_processing_checks: "GSTIN, HSN કોડ અને GSTR-2B મેચ તપાસી રહ્યા છીએ",
  tr_invoice_analyzed: "ઇન્વૉઇસ તપાસ્યું",
  tr_itc: "ITC",
  tr_narrated_on_device: "ફોન પર જ વાંચી સંભળાવ્યું",
  tr_hsn_match: "ફોન પરની HSN મેચ",
  tr_processing_failed_title: "પ્રક્રિયા નિષ્ફળ",
  tr_quota_reached: "API વપરાશ મર્યાદા પૂરી થઈ. કાલે ફરી પ્રયાસ કરો અથવા સપોર્ટનો સંપર્ક કરો.",
  tr_invoice_processed: "ઇન્વૉઇસ પર પ્રક્રિયા થઈ ગઈ!",
  tr_no_active_trader: "કોઈ સક્રિય વેપારી નથી. પહેલાં તમારો GSTIN સેટ કરો.",
  tr_processing_failed_retry: "પ્રક્રિયા નિષ્ફળ. ફરી પ્રયાસ કરો.",
  tr_location_note: "તમે સામાન્ય રીતે જ્યાં સ્કેન કરો છો ત્યાંથી ~{km}km દૂર સ્કેન થયું.",

  // ITC verdict status labels
  tr_status_confirmed: "નિશ્ચિત",
  tr_status_fixable_blocked: "બ્લોક — સુધારી શકાય",
  tr_status_at_risk: "જોખમમાં",
  tr_status_missed: "ITC ચૂકી ગયું",
  tr_status_ineligible: "અપાત્ર",
  tr_status_fraud_flagged: "ફ્રોડની શંકા",
  tr_status_duplicate: "ડુપ્લિકેટ",
  tr_status_processing: "પ્રક્રિયા ચાલુ",
  tr_status_pending: "બાકી",

  // Home / history
  tr_financial_snapshot: "નાણાકીય ચિત્ર",
  tr_required_actions: "જરૂરી કાર્યવાહી",
  tr_invoice_history: "ઇન્વૉઇસ ઇતિહાસ",
  tr_no_invoices_yet: "હજી કોઈ ઇન્વૉઇસ નથી. તમારું પહેલું ઇન્વૉઇસ સ્કેન કરો!",
  tr_unknown_supplier: "અજાણ્યો સપ્લાયર",
  tr_history: "ઇતિહાસ",

  // Scan button + on-device photo check
  tr_checking_photo: "ફોટો તપાસી રહ્યા છીએ…",
  tr_processing: "પ્રક્રિયા ચાલુ છે…",
  tr_scan_invoice: "ઇન્વૉઇસ સ્કેન કરો",
  tr_photo_may_not_scan: "ફોટો બરાબર સ્કેન નહીં થાય",
  tr_retake_glare:
    "બહુ ચમક છે — સીધો પ્રકાશ કે ફ્લેશ ઇન્વૉઇસ પર ન પડવા દો, પછી ફરી ફોટો લો.",
  tr_retake_blur:
    "ફોટો ઝાંખો છે — કેમેરા સ્થિર રાખો અને ફોકસ થવા દો, પછી ફરી ફોટો લો.",
  tr_retake_photo: "ફરી ફોટો લો",
  tr_upload_anyway: "તો પણ અપલોડ કરો",
  tr_checked_on_device: "તમારા ફોન પર જ તપાસ્યું — આ તપાસ માટે કોઈ ડેટા અપલોડ થયો નથી.",

  // --- Camera scanner (/trader/scanner) --------------------------------
  sc_align_invoice: "ઇન્વૉઇસ ફ્રેમની અંદર રાખો",
  sc_invoice_captured: "ઇન્વૉઇસ કેપ્ચર થયું",
  sc_extracted_synced: "Munim.ai એ માહિતી કાઢીને તમારા CA ના ડેશબોર્ડ સાથે સિંક કરી દીધી છે.",
  sc_supplier: "સપ્લાયર",
  sc_amount: "રકમ",
  sc_gstin: "GSTIN",
  sc_scan_another: "બીજું ઇન્વૉઇસ સ્કેન કરો",

  // Common
  loading: "લોડ થઈ રહ્યું છે…",
  error: "કંઈક ખોટું થયું",
  close: "બંધ કરો",
  back: "પાછળ",
  next: "આગળ",
  prev: "પાછલું",
};

export default gu;
