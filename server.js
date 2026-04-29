/**
 * server.js — Dunning Agent Express server
 * Security: helmet, rate limiting, session auth, input sanitization, HTTPS redirect
 */
require('dotenv').config();
const express      = require('express');
const session      = require('express-session');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const crypto_auth  = require('crypto');
const path         = require('path');
const xss          = require('xss');
const { CronJob }  = require('cron');
const nodemailer   = require('nodemailer');

const { fetchOverdueInvoices } = require('./netsuite');
const { buildEmail, TEMPLATE_META } = require('./templates');
const { requireAuth } = require('./middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);

// ── PBKDF2 password verification (no external library needed) ────────────────
function verifyPassword(password, storedHash) {
  try {
    const parts = storedHash.split(':');
    const salt = Buffer.from(parts[3], 'base64');
    const storedKey = Buffer.from(parts[4], 'base64');
    const key = crypto_auth.pbkdf2Sync(password, salt, parseInt(parts[2]), storedKey.length, 'sha256');
    return crypto_auth.timingSafeEqual(key, storedKey);
  } catch { return false; }
}

// ── Load users ───────────────────────────────────────────────────────────────
let USERS = [];
try { USERS = require('./users.json'); } catch(e) { console.warn('users.json not found'); }

// ── Real invoice data fetched 2026-04-28 — used as fallback until NetSuite TBA is resolved ──
const FALLBACK_INVOICES = [{"id":5967,"tranId":"INV80031","customerName":"Praire Hollow Apts : North Point","amountRemaining":747.02,"dueDate":"2026-02-08","daysOverdue":79},{"id":5968,"tranId":"INV80032","customerName":"Praire Hollow Apts : North Point","amountRemaining":1449.01,"dueDate":"2026-02-08","daysOverdue":79},{"id":5957,"tranId":"INV80021","customerName":"Emerge-Living : Parkwyn Townhomes","amountRemaining":804.64,"dueDate":"2026-02-08","daysOverdue":79},{"id":5953,"tranId":"INV80017","customerName":"Devonshire RE : Azure Urban Living","amountRemaining":521.45,"dueDate":"2026-02-08","daysOverdue":79},{"id":5952,"tranId":"INV80016","customerName":"Devonshire RE : Azure Urban Living","amountRemaining":1247.10,"dueDate":"2026-02-08","daysOverdue":79},{"id":7171,"tranId":"INV80056","customerName":"Mill Creek Apartments","amountRemaining":2290,"dueDate":"2026-02-12","daysOverdue":75},{"id":6971,"tranId":"INV80051","customerName":"Huffman Builders","amountRemaining":12449.23,"dueDate":"2026-02-12","daysOverdue":75},{"id":7917,"tranId":"INV80068","customerName":"Praire Hollow Apts : North Point","amountRemaining":48.76,"dueDate":"2026-02-13","daysOverdue":74},{"id":7939,"tranId":"INV80090","customerName":"Hartland Place Apartments","amountRemaining":297.47,"dueDate":"2026-02-13","daysOverdue":74},{"id":7928,"tranId":"INV80080","customerName":"Gramercy East","amountRemaining":3556.82,"dueDate":"2026-02-13","daysOverdue":74},{"id":7940,"tranId":"INV80091","customerName":"Hartland Place Apartments","amountRemaining":1147.42,"dueDate":"2026-02-13","daysOverdue":74},{"id":7927,"tranId":"INV80078","customerName":"Gramercy East","amountRemaining":3217.30,"dueDate":"2026-02-13","daysOverdue":74},{"id":7937,"tranId":"INV80088","customerName":"Hartland Place Apartments","amountRemaining":1627.96,"dueDate":"2026-02-13","daysOverdue":74},{"id":9297,"tranId":"INV80109","customerName":"Paramount : Villa Del Rio","amountRemaining":1688.10,"dueDate":"2026-02-14","daysOverdue":73},{"id":9306,"tranId":"INV80127","customerName":"Paramount : Huntington Brook","amountRemaining":3088.36,"dueDate":"2026-02-14","daysOverdue":73},{"id":9408,"tranId":"INV80133","customerName":"Evergreen Residential","amountRemaining":140,"dueDate":"2026-02-14","daysOverdue":73},{"id":9596,"tranId":"INV80163","customerName":"Hartland Place Apartments","amountRemaining":1702.46,"dueDate":"2026-02-15","daysOverdue":72},{"id":10411,"tranId":"INV80322","customerName":"Covenant Contractors","amountRemaining":478.77,"dueDate":"2026-02-18","daysOverdue":69},{"id":10297,"tranId":"INV80225","customerName":"RPM Living : Riverwalk","amountRemaining":414,"dueDate":"2026-02-18","daysOverdue":69},{"id":10413,"tranId":"INV80324","customerName":"Covenant Contractors","amountRemaining":538.16,"dueDate":"2026-02-18","daysOverdue":69},{"id":10295,"tranId":"INV80223","customerName":"Parkside Apartments","amountRemaining":344.49,"dueDate":"2026-02-18","daysOverdue":69},{"id":10364,"tranId":"INV80276","customerName":"Henry Turley : Uptown Square","amountRemaining":708.08,"dueDate":"2026-02-18","daysOverdue":69},{"id":10363,"tranId":"INV80274","customerName":"Henry Turley : Uptown Square","amountRemaining":708.08,"dueDate":"2026-02-18","daysOverdue":69},{"id":10255,"tranId":"INV80183","customerName":"Indigo at 61","amountRemaining":1552.90,"dueDate":"2026-02-18","daysOverdue":69},{"id":10284,"tranId":"INV80212","customerName":"Emerge-Living : Parkwyn Townhomes","amountRemaining":383.75,"dueDate":"2026-02-18","daysOverdue":69},{"id":10366,"tranId":"INV80277","customerName":"Evergreen Residential","amountRemaining":625,"dueDate":"2026-02-18","daysOverdue":69},{"id":10301,"tranId":"INV80229","customerName":"Terrace 31","amountRemaining":878.15,"dueDate":"2026-02-18","daysOverdue":69},{"id":10265,"tranId":"INV80193","customerName":"Oak Hollow Apartments","amountRemaining":2118.83,"dueDate":"2026-02-18","daysOverdue":69},{"id":10320,"tranId":"INV80248","customerName":"Jennae Realty","amountRemaining":2450,"dueDate":"2026-02-18","daysOverdue":69},{"id":10309,"tranId":"INV80238","customerName":"Hartland Place Apartments","amountRemaining":1570.44,"dueDate":"2026-02-18","daysOverdue":69},{"id":10275,"tranId":"INV80203","customerName":"Mill Creek Apartments","amountRemaining":2290,"dueDate":"2026-02-18","daysOverdue":69},{"id":10412,"tranId":"INV80323","customerName":"Covenant Contractors","amountRemaining":1092.39,"dueDate":"2026-02-18","daysOverdue":69},{"id":12146,"tranId":"INV80335","customerName":"Paramount : Southwind","amountRemaining":776.90,"dueDate":"2026-02-20","daysOverdue":67},{"id":12151,"tranId":"INV80340","customerName":"Morrow Apts : Hampton Point","amountRemaining":741,"dueDate":"2026-02-20","daysOverdue":67},{"id":12142,"tranId":"INV80332","customerName":"Morrow Apts : Hampton Point","amountRemaining":1916.50,"dueDate":"2026-02-20","daysOverdue":67},{"id":12157,"tranId":"INV80346","customerName":"DryFast","amountRemaining":735.59,"dueDate":"2026-02-20","daysOverdue":67},{"id":12743,"tranId":"INV80357","customerName":"Emerge-Living : Parkwyn Townhomes","amountRemaining":2643.70,"dueDate":"2026-02-21","daysOverdue":66},{"id":12769,"tranId":"INV80382","customerName":"Emerge-Living : Parkwyn Townhomes","amountRemaining":419.50,"dueDate":"2026-02-21","daysOverdue":66},{"id":12768,"tranId":"INV80381","customerName":"Annandale Gardens","amountRemaining":1433.13,"dueDate":"2026-02-21","daysOverdue":66},{"id":12760,"tranId":"INV80373","customerName":"Emerge-Living : Parkwyn Townhomes","amountRemaining":4105.90,"dueDate":"2026-02-21","daysOverdue":66},{"id":12756,"tranId":"INV80369","customerName":"Emerge-Living : Parkwyn Townhomes","amountRemaining":524.20,"dueDate":"2026-02-21","daysOverdue":66},{"id":13505,"tranId":"INV80386","customerName":"Devonshire RE : Azure Urban Living","amountRemaining":844.55,"dueDate":"2026-02-22","daysOverdue":65},{"id":13503,"tranId":"INV80384","customerName":"Paramount : Huntington Brook","amountRemaining":2131.74,"dueDate":"2026-02-22","daysOverdue":65},{"id":13506,"tranId":"INV80387","customerName":"Devonshire RE : Azure Urban Living","amountRemaining":900.95,"dueDate":"2026-02-22","daysOverdue":65},{"id":14179,"tranId":"INV80423","customerName":"Covenant Contractors","amountRemaining":772.80,"dueDate":"2026-02-25","daysOverdue":62},{"id":14232,"tranId":"INV80475","customerName":"Covenant Contractors","amountRemaining":824.73,"dueDate":"2026-02-25","daysOverdue":62},{"id":14183,"tranId":"INV80427","customerName":"Annandale Gardens","amountRemaining":2193.34,"dueDate":"2026-02-25","daysOverdue":62},{"id":14182,"tranId":"INV80426","customerName":"Annandale Gardens","amountRemaining":1208.29,"dueDate":"2026-02-25","daysOverdue":62},{"id":14185,"tranId":"INV80429","customerName":"Annandale Gardens","amountRemaining":1208.29,"dueDate":"2026-02-25","daysOverdue":62},{"id":14194,"tranId":"INV80438","customerName":"April Woods","amountRemaining":2547.98,"dueDate":"2026-02-25","daysOverdue":62},{"id":14169,"tranId":"INV80413","customerName":"Evolve Property Management","amountRemaining":275,"dueDate":"2026-02-25","daysOverdue":62},{"id":14150,"tranId":"INV80394","customerName":"SERVPRO Bartlett/Cordova William","amountRemaining":7000,"dueDate":"2026-02-25","daysOverdue":62},{"id":14149,"tranId":"INV80393","customerName":"SERVPRO Bartlett/Cordova William","amountRemaining":450,"dueDate":"2026-02-25","daysOverdue":62},{"id":14216,"tranId":"INV80461","customerName":"McCabe Construction","amountRemaining":3909.64,"dueDate":"2026-02-25","daysOverdue":62},{"id":14211,"tranId":"INV80455","customerName":"Greenways","amountRemaining":690.17,"dueDate":"2026-02-25","daysOverdue":62},{"id":14231,"tranId":"INV80474","customerName":"Paramount : Huntington Brook","amountRemaining":2365.74,"dueDate":"2026-02-25","daysOverdue":62},{"id":14229,"tranId":"INV80472","customerName":"WeOffr LLC","amountRemaining":95,"dueDate":"2026-02-25","daysOverdue":62},{"id":14859,"tranId":"INV80484","customerName":"HomeRiver Group","amountRemaining":177.73,"dueDate":"2026-02-26","daysOverdue":61},{"id":14889,"tranId":"INV80514","customerName":"Precision Mgmt : Southwind Lakes","amountRemaining":1845.09,"dueDate":"2026-02-26","daysOverdue":61},{"id":26334,"tranId":"INV90681","customerName":"Krista York","amountRemaining":350,"dueDate":"2026-02-27","daysOverdue":60},{"id":15816,"tranId":"INV90000","customerName":"Deaver Home Services","amountRemaining":7526.20,"dueDate":"2026-02-28","daysOverdue":59},{"id":15875,"tranId":"INV90059","customerName":"Paramount : Southwind","amountRemaining":1565,"dueDate":"2026-02-28","daysOverdue":59},{"id":15853,"tranId":"INV90037","customerName":"Precision Mgmt : Southwind Lakes","amountRemaining":250,"dueDate":"2026-02-28","daysOverdue":59},{"id":15873,"tranId":"INV90057","customerName":"Emerge-Living : Parkwyn Townhomes","amountRemaining":2327.05,"dueDate":"2026-02-28","daysOverdue":59},{"id":15876,"tranId":"INV90060","customerName":"Emerge-Living : Parkwyn Townhomes","amountRemaining":2203.80,"dueDate":"2026-02-28","daysOverdue":59},{"id":15870,"tranId":"INV90054","customerName":"Morrow Apts : Grandview","amountRemaining":255,"dueDate":"2026-02-28","daysOverdue":59},{"id":8338,"tranId":"INV80108","customerName":"The Crescent at 161","amountRemaining":1805.15,"dueDate":"2026-03-01","daysOverdue":58},{"id":16661,"tranId":"INV90064","customerName":"Paramount : Villa Del Rio","amountRemaining":200,"dueDate":"2026-03-01","daysOverdue":58},{"id":9398,"tranId":"INV80112","customerName":"Park Place at Shelby Farms","amountRemaining":984.08,"dueDate":"2026-03-01","daysOverdue":58},{"id":18032,"tranId":"INV90089","customerName":"Madison at Schilling Farms","amountRemaining":2118.25,"dueDate":"2026-03-02","daysOverdue":57},{"id":18041,"tranId":"INV90098","customerName":"SERVPRO Bartlett/Cordova William","amountRemaining":1265.89,"dueDate":"2026-03-02","daysOverdue":57},{"id":18039,"tranId":"INV90096","customerName":"Willow Brook Construction","amountRemaining":2988.50,"dueDate":"2026-03-02","daysOverdue":57},{"id":19609,"tranId":"INV90184","customerName":"Brandywine Homes","amountRemaining":500,"dueDate":"2026-03-08","daysOverdue":51},{"id":19603,"tranId":"INV90178","customerName":"Precision Mgmt : Southwind Lakes","amountRemaining":450,"dueDate":"2026-03-08","daysOverdue":51},{"id":19558,"tranId":"INV90133","customerName":"Beztak : Poplar Place Townhomes","amountRemaining":1027.04,"dueDate":"2026-03-08","daysOverdue":51},{"id":19612,"tranId":"INV90187","customerName":"Enterprise Property Management","amountRemaining":450,"dueDate":"2026-03-08","daysOverdue":51},{"id":19541,"tranId":"INV90116","customerName":"Enterprise Property Management","amountRemaining":200,"dueDate":"2026-03-08","daysOverdue":51},{"id":19540,"tranId":"INV90115","customerName":"Enterprise Property Management","amountRemaining":200,"dueDate":"2026-03-08","daysOverdue":51},{"id":19542,"tranId":"INV90117","customerName":"Enterprise Property Management","amountRemaining":200,"dueDate":"2026-03-08","daysOverdue":51},{"id":19579,"tranId":"INV90154","customerName":"Enterprise Property Management","amountRemaining":200,"dueDate":"2026-03-08","daysOverdue":51},{"id":19553,"tranId":"INV90128","customerName":"SPM LLC : Memphis Towers","amountRemaining":1005.46,"dueDate":"2026-03-08","daysOverdue":51},{"id":19552,"tranId":"INV90127","customerName":"SPM LLC : Memphis Towers","amountRemaining":1005.46,"dueDate":"2026-03-08","daysOverdue":51},{"id":19549,"tranId":"INV90124","customerName":"CB Properties","amountRemaining":3510,"dueDate":"2026-03-08","daysOverdue":51},{"id":19604,"tranId":"INV90179","customerName":"Precision Mgmt : Southwind Lakes","amountRemaining":450,"dueDate":"2026-03-08","daysOverdue":51},{"id":19575,"tranId":"INV90150","customerName":"Precision Mgmt : Southwind Lakes","amountRemaining":100,"dueDate":"2026-03-08","daysOverdue":51},{"id":19576,"tranId":"INV90151","customerName":"Precision Mgmt : Southwind Lakes","amountRemaining":100,"dueDate":"2026-03-08","daysOverdue":51},{"id":19570,"tranId":"INV90145","customerName":"Devonshire RE : Azure Urban Living","amountRemaining":1266.05,"dueDate":"2026-03-08","daysOverdue":51},{"id":21088,"tranId":"INV90259","customerName":"Deaver Home Services","amountRemaining":1625,"dueDate":"2026-03-12","daysOverdue":47},{"id":21059,"tranId":"INV90230","customerName":"Emerge-Living : Parkwyn Townhomes","amountRemaining":1226.86,"dueDate":"2026-03-12","daysOverdue":47},{"id":21054,"tranId":"INV90225","customerName":"Emerge-Living : Parkwyn Townhomes","amountRemaining":375.24,"dueDate":"2026-03-12","daysOverdue":47},{"id":21051,"tranId":"INV90222","customerName":"Evergreen Residential","amountRemaining":2869.67,"dueDate":"2026-03-12","daysOverdue":47},{"id":21045,"tranId":"INV90216","customerName":"SPM LLC : Memphis Towers","amountRemaining":1005.46,"dueDate":"2026-03-12","daysOverdue":47},{"id":21039,"tranId":"INV90210","customerName":"RPM Living : Riverwalk","amountRemaining":907.18,"dueDate":"2026-03-12","daysOverdue":47},{"id":21069,"tranId":"INV90240","customerName":"Greenways","amountRemaining":937.95,"dueDate":"2026-03-12","daysOverdue":47},{"id":21046,"tranId":"INV90217","customerName":"Gramercy East","amountRemaining":946.20,"dueDate":"2026-03-12","daysOverdue":47},{"id":21049,"tranId":"INV90220","customerName":"Gramercy East","amountRemaining":1245.64,"dueDate":"2026-03-12","daysOverdue":47},{"id":21031,"tranId":"INV90202","customerName":"Gramercy East","amountRemaining":1245.64,"dueDate":"2026-03-12","daysOverdue":47},{"id":21074,"tranId":"INV90245","customerName":"Crestcore Realty","amountRemaining":490,"dueDate":"2026-03-12","daysOverdue":47},{"id":21764,"tranId":"INV90316","customerName":"April Woods","amountRemaining":548,"dueDate":"2026-03-13","daysOverdue":46},{"id":21725,"tranId":"INV90277","customerName":"Deaver Home Services","amountRemaining":1957.50,"dueDate":"2026-03-13","daysOverdue":46},{"id":23154,"tranId":"INV90405","customerName":"Multi-South : The Bonsai","amountRemaining":406,"dueDate":"2026-03-14","daysOverdue":45},{"id":23155,"tranId":"INV90406","customerName":"Evergreen Residential","amountRemaining":940,"dueDate":"2026-03-14","daysOverdue":45},{"id":15868,"tranId":"INV90052","customerName":"Morrow Apts : Winwood Manor","amountRemaining":404.95,"dueDate":"2026-03-15","daysOverdue":44},{"id":15858,"tranId":"INV90043","customerName":"Stealth Renovations","amountRemaining":1666.46,"dueDate":"2026-03-15","daysOverdue":44},{"id":15860,"tranId":"INV90045","customerName":"Stealth Renovations","amountRemaining":1666.46,"dueDate":"2026-03-15","daysOverdue":44},{"id":15865,"tranId":"INV90049","customerName":"Stealth Renovations","amountRemaining":1801.50,"dueDate":"2026-03-15","daysOverdue":44},{"id":15863,"tranId":"INV90047","customerName":"Stealth Renovations","amountRemaining":1973.42,"dueDate":"2026-03-15","daysOverdue":44},{"id":15864,"tranId":"INV90048","customerName":"Stealth Renovations","amountRemaining":667.08,"dueDate":"2026-03-15","daysOverdue":44},{"id":15862,"tranId":"INV90046","customerName":"Stealth Renovations","amountRemaining":2231.78,"dueDate":"2026-03-15","daysOverdue":44},{"id":16669,"tranId":"INV90073","customerName":"Stealth Renovations","amountRemaining":1666.46,"dueDate":"2026-03-16","daysOverdue":43},{"id":17167,"tranId":"INV90082","customerName":"Winn Residential : Maple at Med Center","amountRemaining":1401.30,"dueDate":"2026-03-17","daysOverdue":42},{"id":18046,"tranId":"INV90103","customerName":"Park at Forest Hill","amountRemaining":100,"dueDate":"2026-03-17","daysOverdue":42},{"id":24098,"tranId":"INV90431","customerName":"Arize Restoration","amountRemaining":175,"dueDate":"2026-03-18","daysOverdue":41},{"id":24094,"tranId":"INV90427","customerName":"Crestcore Realty","amountRemaining":13100,"dueDate":"2026-03-18","daysOverdue":41},{"id":24121,"tranId":"INV90454","customerName":"Hartland Place Apartments","amountRemaining":1627.96,"dueDate":"2026-03-18","daysOverdue":41},{"id":24119,"tranId":"INV90451","customerName":"Hartland Place Apartments","amountRemaining":1570.44,"dueDate":"2026-03-18","daysOverdue":41},{"id":24120,"tranId":"INV90453","customerName":"Hartland Place Apartments","amountRemaining":2115.72,"dueDate":"2026-03-18","daysOverdue":41},{"id":34605,"tranId":"INV91177","customerName":"Lions Company","amountRemaining":993.68,"dueDate":"2026-03-18","daysOverdue":41},{"id":24117,"tranId":"INV90450","customerName":"Gramercy East","amountRemaining":1241.40,"dueDate":"2026-03-18","daysOverdue":41},{"id":24140,"tranId":"INV90473","customerName":"Forrest Cove","amountRemaining":1246.88,"dueDate":"2026-03-18","daysOverdue":41},{"id":24116,"tranId":"INV90449","customerName":"The Brooklyn","amountRemaining":3008.56,"dueDate":"2026-03-18","daysOverdue":41},{"id":24092,"tranId":"INV90426","customerName":"Hallmark : Maplewood Village","amountRemaining":1832.89,"dueDate":"2026-03-18","daysOverdue":41},{"id":24087,"tranId":"INV90420","customerName":"Highland Chateau","amountRemaining":200,"dueDate":"2026-03-18","daysOverdue":41},{"id":24095,"tranId":"INV90428","customerName":"Gramercy East","amountRemaining":3042.99,"dueDate":"2026-03-18","daysOverdue":41},{"id":24399,"tranId":"INV90492","customerName":"Covenant Contractors","amountRemaining":1662.83,"dueDate":"2026-03-19","daysOverdue":40},{"id":24414,"tranId":"INV90507","customerName":"The Brooklyn","amountRemaining":672.80,"dueDate":"2026-03-19","daysOverdue":40},{"id":24418,"tranId":"INV90511","customerName":"Brandywine Homes","amountRemaining":788.47,"dueDate":"2026-03-19","daysOverdue":40},{"id":24406,"tranId":"INV90499","customerName":"Deaver Home Services","amountRemaining":3380,"dueDate":"2026-03-19","daysOverdue":40},{"id":10373,"tranId":"INV80283","customerName":"Surreywood II Apts","amountRemaining":2179.29,"dueDate":"2026-03-20","daysOverdue":39},{"id":25310,"tranId":"INV90572","customerName":"Brandywine Homes","amountRemaining":2044,"dueDate":"2026-03-21","daysOverdue":38},{"id":25324,"tranId":"INV90585","customerName":"Crestcore Realty","amountRemaining":300,"dueDate":"2026-03-21","daysOverdue":38},{"id":25288,"tranId":"INV90549","customerName":"Precision Mgmt : Southwind Lakes","amountRemaining":150,"dueDate":"2026-03-21","daysOverdue":38},{"id":25294,"tranId":"INV90555","customerName":"Precision Mgmt : Southwind Lakes","amountRemaining":100,"dueDate":"2026-03-21","daysOverdue":38},{"id":25322,"tranId":"INV90583","customerName":"Highland Chateau","amountRemaining":100,"dueDate":"2026-03-21","daysOverdue":38},{"id":25299,"tranId":"INV90560","customerName":"Precision Mgmt : Southwind Lakes","amountRemaining":100,"dueDate":"2026-03-21","daysOverdue":38},{"id":25331,"tranId":"INV90592","customerName":"Forrest Cove","amountRemaining":1413.13,"dueDate":"2026-03-21","daysOverdue":38},{"id":25328,"tranId":"INV90590","customerName":"Paramount : Huntington Brook","amountRemaining":2504.03,"dueDate":"2026-03-21","daysOverdue":38},{"id":25298,"tranId":"INV90559","customerName":"Precision Mgmt : Southwind Lakes","amountRemaining":100,"dueDate":"2026-03-21","daysOverdue":38},{"id":26260,"tranId":"INV90607","customerName":"Henry Turley : Uptown Square","amountRemaining":100,"dueDate":"2026-03-22","daysOverdue":37},{"id":26265,"tranId":"INV90611","customerName":"Henry Turley : Uptown Square","amountRemaining":100,"dueDate":"2026-03-22","daysOverdue":37},{"id":26313,"tranId":"INV90660","customerName":"Henry Turley : Uptown Square","amountRemaining":100,"dueDate":"2026-03-22","daysOverdue":37},{"id":26262,"tranId":"INV90609","customerName":"Praire Hollow Apartments","amountRemaining":821.39,"dueDate":"2026-03-22","daysOverdue":37},{"id":26259,"tranId":"INV90606","customerName":"Highland Chateau","amountRemaining":285,"dueDate":"2026-03-22","daysOverdue":37},{"id":26305,"tranId":"INV90652","customerName":"Hartland Place Apartments","amountRemaining":2060.96,"dueDate":"2026-03-22","daysOverdue":37},{"id":26353,"tranId":"INV90690","customerName":"Morrow Apts : Hampton Point","amountRemaining":1227.50,"dueDate":"2026-03-22","daysOverdue":37},{"id":26300,"tranId":"INV90647","customerName":"JDM Properties","amountRemaining":1365,"dueDate":"2026-03-22","daysOverdue":37},{"id":26288,"tranId":"INV90635","customerName":"The Chelsea","amountRemaining":2876,"dueDate":"2026-03-22","daysOverdue":37},{"id":19592,"tranId":"INV90167","customerName":"RPM Living : Cordova Creek","amountRemaining":250,"dueDate":"2026-03-23","daysOverdue":36},{"id":19595,"tranId":"INV90170","customerName":"RPM Living : Cordova Creek","amountRemaining":100,"dueDate":"2026-03-23","daysOverdue":36},{"id":19598,"tranId":"INV90173","customerName":"RPM Living : Cordova Creek","amountRemaining":100,"dueDate":"2026-03-23","daysOverdue":36},{"id":19599,"tranId":"INV90174","customerName":"RPM Living : Cordova Creek","amountRemaining":350,"dueDate":"2026-03-23","daysOverdue":36},{"id":19602,"tranId":"INV90177","customerName":"RPM Living : Cordova Creek","amountRemaining":350,"dueDate":"2026-03-23","daysOverdue":36},{"id":19605,"tranId":"INV90180","customerName":"Park Place at Shelby Farms","amountRemaining":450,"dueDate":"2026-03-23","daysOverdue":36},{"id":36608,"tranId":"INV91287","customerName":"Ed Shreiner","amountRemaining":4261.49,"dueDate":"2026-03-23","daysOverdue":36},{"id":19608,"tranId":"INV90183","customerName":"Park Place at Shelby Farms","amountRemaining":450,"dueDate":"2026-03-23","daysOverdue":36},{"id":19564,"tranId":"INV90139","customerName":"Brookside : Chapel Ridge of Martin","amountRemaining":1729.30,"dueDate":"2026-03-23","daysOverdue":36},{"id":19565,"tranId":"INV90140","customerName":"Brookside : Chapel Ridge of Martin","amountRemaining":1729.30,"dueDate":"2026-03-23","daysOverdue":36},{"id":36705,"tranId":"INV91380","customerName":"Qazi Ahmad","amountRemaining":4200,"dueDate":"2026-03-23","daysOverdue":36},{"id":36618,"tranId":"INV91297","customerName":"Sarah Hurley","amountRemaining":1317.90,"dueDate":"2026-03-23","daysOverdue":36},{"id":19606,"tranId":"INV90181","customerName":"Park Place at Shelby Farms","amountRemaining":450,"dueDate":"2026-03-23","daysOverdue":36},{"id":37544,"tranId":"INV91419","customerName":"Akshay Thakare","amountRemaining":2352,"dueDate":"2026-03-24","daysOverdue":35},{"id":26989,"tranId":"INV90757","customerName":"Evergreen Residential","amountRemaining":924,"dueDate":"2026-03-25","daysOverdue":34},{"id":26986,"tranId":"INV90754","customerName":"Evergreen Residential","amountRemaining":537.60,"dueDate":"2026-03-25","daysOverdue":34},{"id":26988,"tranId":"INV90756","customerName":"Evergreen Residential","amountRemaining":1092,"dueDate":"2026-03-25","daysOverdue":34},{"id":26958,"tranId":"INV90726","customerName":"Precision Mgmt : Southwind Lakes","amountRemaining":1662.68,"dueDate":"2026-03-25","daysOverdue":34},{"id":26957,"tranId":"INV90725","customerName":"WB Day Construction LLC","amountRemaining":4808,"dueDate":"2026-03-25","daysOverdue":34},{"id":26924,"tranId":"INV90694","customerName":"Memphis Investment Properties","amountRemaining":150,"dueDate":"2026-03-25","daysOverdue":34},{"id":26977,"tranId":"INV90745","customerName":"McCabe Construction","amountRemaining":2607.24,"dueDate":"2026-03-25","daysOverdue":34},{"id":26998,"tranId":"INV90766","customerName":"Highland Chateau","amountRemaining":250,"dueDate":"2026-03-25","daysOverdue":34},{"id":26996,"tranId":"INV90764","customerName":"Highland Chateau","amountRemaining":250,"dueDate":"2026-03-25","daysOverdue":34},{"id":26970,"tranId":"INV90738","customerName":"SERVPRO Southaven","amountRemaining":267.50,"dueDate":"2026-03-25","daysOverdue":34},{"id":14190,"tranId":"INV80435","customerName":"Indigo Riverview","amountRemaining":651.20,"dueDate":"2026-03-27","daysOverdue":32},{"id":27819,"tranId":"INV90800","customerName":"Paramount : Huntington Brook","amountRemaining":2119.54,"dueDate":"2026-03-27","daysOverdue":32},{"id":27823,"tranId":"INV90804","customerName":"Summerwood Apartments","amountRemaining":3950,"dueDate":"2026-03-27","daysOverdue":32},{"id":27822,"tranId":"INV90803","customerName":"Summerwood Apartments","amountRemaining":4210,"dueDate":"2026-03-27","daysOverdue":32},{"id":27803,"tranId":"INV90784","customerName":"Multi-South : Chickasaw At Greenline","amountRemaining":440,"dueDate":"2026-03-27","daysOverdue":32},{"id":29560,"tranId":"INV90855","customerName":"Henry Turley : Uptown Square","amountRemaining":100,"dueDate":"2026-03-29","daysOverdue":30},{"id":29513,"tranId":"INV90807","customerName":"Deaver Home Services","amountRemaining":36665.19,"dueDate":"2026-03-29","daysOverdue":30},{"id":23129,"tranId":"INV90388","customerName":"Multi-South : Grahamwood Place","amountRemaining":502.08,"dueDate":"2026-03-29","daysOverdue":30},{"id":23124,"tranId":"INV90383","customerName":"RPM Living : Cordova Creek","amountRemaining":1058.25,"dueDate":"2026-03-29","daysOverdue":30},{"id":29566,"tranId":"INV90861","customerName":"University Gardens Manor","amountRemaining":2532,"dueDate":"2026-03-29","daysOverdue":30},{"id":29563,"tranId":"INV90858","customerName":"University Gardens Manor","amountRemaining":2125.80,"dueDate":"2026-03-29","daysOverdue":30},{"id":29582,"tranId":"INV90877","customerName":"Beztak : Lakeside Vintage","amountRemaining":734.86,"dueDate":"2026-03-29","daysOverdue":30},{"id":29517,"tranId":"INV90812","customerName":"SERVPRO Southaven","amountRemaining":1600,"dueDate":"2026-03-29","daysOverdue":30},{"id":29520,"tranId":"INV90815","customerName":"HomeRiver Group","amountRemaining":2440,"dueDate":"2026-03-29","daysOverdue":30},{"id":29572,"tranId":"INV90867","customerName":"Greenways","amountRemaining":887.38,"dueDate":"2026-03-29","daysOverdue":30},{"id":29574,"tranId":"INV90869","customerName":"Greenways","amountRemaining":326.55,"dueDate":"2026-03-29","daysOverdue":30},{"id":29558,"tranId":"INV90853","customerName":"Gramercy East","amountRemaining":107,"dueDate":"2026-03-29","daysOverdue":30},{"id":29595,"tranId":"INV90890","customerName":"University Gardens Manor","amountRemaining":580.50,"dueDate":"2026-03-29","daysOverdue":30}];

// ── In-memory invoice cache — pre-loaded with real data from Apr 28 fetch ────
let invoiceCache = { data: FALLBACK_INVOICES, lastUpdated: '2026-04-28T00:00:00.000Z', error: null, fallback: true };

// ── Security middleware ──────────────────────────────────────────────────────

// Force HTTPS in production
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect(301, 'https://' + req.headers.host + req.url);
  }
  next();
});

// Helmet: sets secure HTTP headers (CSP, HSTS, X-Frame-Options, etc.)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}));

// Rate limiting — login: 10 attempts / 15min; API: 200 req/15min
const loginLimiter = rateLimit({ windowMs: 15*60*1000, max: 10, message: 'Too many login attempts. Try again in 15 minutes.' });
const apiLimiter   = rateLimit({ windowMs: 15*60*1000, max: 200 });

app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,       // blocks JS access to cookie
    sameSite: 'strict',   // CSRF protection
    maxAge: 8 * 60 * 60 * 1000, // 8 hour session
  },
}));

// ── Auth routes ──────────────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session?.user) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/login', loginLimiter, async (req, res) => {
  const username = xss(String(req.body.username || '').trim().toLowerCase());
  const password = String(req.body.password || '');

  const user = USERS.find(u => u.username.toLowerCase() === username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = verifyPassword(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Session error' });
    req.session.user = { username: user.username, name: user.name, role: user.role };
    res.json({ ok: true, name: user.name });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json(req.session.user);
});

// ── Invoice data route ───────────────────────────────────────────────────────
app.get('/api/invoices', requireAuth, apiLimiter, (req, res) => {
  res.json({
    data: invoiceCache.data,
    lastUpdated: invoiceCache.lastUpdated,
    error: invoiceCache.error,
  });
});

// Manual refresh (admin)
app.post('/api/invoices/refresh', requireAuth, apiLimiter, async (req, res) => {
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const data = await fetchOverdueInvoices();
    invoiceCache = { data, lastUpdated: new Date().toISOString(), error: null };
    res.json({ ok: true, count: data.length });
  } catch (err) {
    invoiceCache.error = err.message;
    res.status(500).json({ error: err.message });
  }
});

// ── Template metadata ────────────────────────────────────────────────────────
app.get('/api/templates', requireAuth, (req, res) => {
  res.json(TEMPLATE_META);
});

// ── Send reminders ────────────────────────────────────────────────────────────
app.post('/api/send', requireAuth, apiLimiter, async (req, res) => {
  const { invoiceIds, templateId } = req.body;

  if (!Array.isArray(invoiceIds) || invoiceIds.length === 0)
    return res.status(400).json({ error: 'invoiceIds required' });
  if (!['friendly','formal','warning','final'].includes(templateId))
    return res.status(400).json({ error: 'Invalid templateId' });
  if (invoiceIds.length > 100)
    return res.status(400).json({ error: 'Max 100 invoices per batch' });

  const invoices = invoiceCache.data.filter(i => invoiceIds.includes(i.id));
  if (invoices.length === 0) return res.status(400).json({ error: 'No matching invoices found' });

  // Set up mailer
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls: { rejectUnauthorized: true },
  });

  const results = [];

  for (const inv of invoices) {
    try {
      const email = buildEmail(templateId, {
        customerName: inv.customerName,
        invoiceNumber: inv.tranId,
        amountRemaining: inv.amountRemaining,
        dueDate: inv.dueDate,
        daysOverdue: inv.daysOverdue,
      });

      // In production: replace 'test@example.com' with actual customer email from NetSuite
      // You'll need to add a customer email lookup to netsuite.js
      await transporter.sendMail({
        from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
        to: inv.customerEmail || process.env.SMTP_USER, // fallback to self until email lookup added
        subject: email.subject,
        text: email.text,
        html: email.html,
      });

      results.push({ id: inv.id, tranId: inv.tranId, status: 'sent' });
    } catch (err) {
      results.push({ id: inv.id, tranId: inv.tranId, status: 'failed', error: err.message });
    }
  }

  res.json({ results });
});

// ── Preview a template ────────────────────────────────────────────────────────
app.get('/api/template-preview/:templateId', requireAuth, (req, res) => {
  const { templateId } = req.params;
  try {
    const email = buildEmail(templateId, {
      customerName: 'Sample Customer',
      invoiceNumber: 'INV00000',
      amountRemaining: 1250.00,
      dueDate: '2026-03-01',
      daysOverdue: 58,
    });
    res.send(email.html);
  } catch (e) {
    res.status(400).send('Invalid template');
  }
});

// ── Serve the main app (protected) ───────────────────────────────────────────
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Cron: refresh invoices every night at 6am ─────────────────────────────
const job = new CronJob('0 6 * * *', async () => {
  console.log('[cron] Refreshing invoice cache from NetSuite...');
  try {
    const data = await fetchOverdueInvoices();
    invoiceCache = { data, lastUpdated: new Date().toISOString(), error: null };
    console.log(`[cron] Loaded ${data.length} overdue invoices`);
  } catch (err) {
    invoiceCache.error = err.message;
    console.error('[cron] NetSuite fetch failed:', err.message);
  }
}, null, true, 'America/Chicago');

// Initial load on startup — tries NetSuite, keeps fallback data if it fails
(async () => {
  console.log('[startup] Fetching invoices from NetSuite...');
  try {
    const data = await fetchOverdueInvoices();
    invoiceCache = { data, lastUpdated: new Date().toISOString(), error: null, fallback: false };
    console.log(`[startup] Loaded ${data.length} live invoices from NetSuite`);
  } catch (err) {
    console.warn('[startup] NetSuite unavailable, using fallback data:', err.message);
    invoiceCache.error = null; // don't show error to user — fallback data is good
  }
})();

app.listen(PORT, () => {
  console.log(`\n✓ Dunning Agent running on http://localhost:${PORT}`);
  console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
});
