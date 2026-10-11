import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import {
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot,
  query, orderBy, serverTimestamp, setDoc
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCSlGFmbmaTORZFTzQ-XWIrjMTSPXzzd7Y",
  authDomain: "lightcut-studio.firebaseapp.com",
  projectId: "lightcut-studio",
  storageBucket: "lightcut-studio.firebasestorage.app",
  messagingSenderId: "422748683786",
  appId: "1:422748683786:web:4ff77eadf64789b0a6a9f3"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = id => document.getElementById(id);
const money = n => (Number(n) || 0).toLocaleString("ca-ES", {style:"currency",currency:"EUR"});
const statuses = ["Pendent de confirmar","Confirmada","En producció","Llista per entregar","Entregada","Cancel·lada"];
let orders = [];
let unsubscribeOrders = null;
let productCounter = 0;
let catalog = [];
let unsubscribeCatalog = null;

function showError(message) { $("loginError").textContent = message; }
function addProductRow(product = {}) {
  const id = ++productCounter;
  const row = document.createElement("div");
  row.className = "product-row";
  row.dataset.rowId = String(id);
  row.innerHTML = `
    <div class="product-name"><label>Producte</label><select class="p-name">
      <option value="">Tria producte...</option>
    </select></div>
    <div><label>Quantitat</label><input class="p-qty" type="number" min="1" step="1" value="1" required></div>
    <div><label>Preu unitari (€)</label><input class="p-price" type="number" min="0" step="0.01" value="0" required></div>
    <div><label>Cost unitari (€)</label><input class="p-cost" type="number" min="0" step="0.01" value="0" required></div>
    <div><button type="button" class="remove-product" aria-label="Eliminar producte">×</button></div>
    <div class="product-notes"><label>Personalització / detalls</label><input class="p-notes" maxlength="500" placeholder="Ex. noms gravats, fusta de roure..."></div>`;
  const nameSelect = row.querySelector(".p-name");
  populateProductSelect(nameSelect, product.name || "");
  nameSelect.addEventListener("change", () => {
    const item = catalog.find(p => p.name === nameSelect.value);
    if (item) {
      row.querySelector(".p-price").value = Number(item.price || 0);
      row.querySelector(".p-cost").value = Number(item.cost || 0);
      if (!row.querySelector(".p-notes").value.trim()) {
        row.querySelector(".p-notes").value = item.description || "";
      }
    }
    updateTotals();
  });
  row.querySelector(".p-qty").value = product.quantity ?? 1;
  row.querySelector(".p-price").value = product.unitPrice ?? 0;
  row.querySelector(".p-cost").value = product.unitCost ?? 0;
  row.querySelector(".p-notes").value = product.notes || "";
  row.querySelectorAll("input,select").forEach(el => el.addEventListener("input", updateTotals));
  row.querySelector(".remove-product").addEventListener("click", () => {
    row.remove();
    if (!$("products").children.length) addProductRow();
    updateTotals();
  });
  $("products").appendChild(row);
  updateTotals();
}

function populateProductSelect(select, selectedName = "") {
  const previous = selectedName || select.value || "";
  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Tria producte...";
  select.appendChild(placeholder);
  catalog.forEach(item => {
    const option = document.createElement("option");
    option.value = item.name;
    option.textContent = item.name;
    select.appendChild(option);
  });
  if (previous && !catalog.some(item => item.name === previous)) {
    const option = document.createElement("option");
    option.value = previous;
    option.textContent = `${previous} (fora del catàleg)`;
    select.appendChild(option);
  }
  select.value = previous;
}
function refreshProductSelects() {
  document.querySelectorAll(".p-name").forEach(select => {
    populateProductSelect(select, select.value);
  });
}
function resetCatalogForm() {
  $("catalogForm").reset();
  $("catalogId").value = "";
  $("catalogPrice").value = "0";
  $("catalogCost").value = "0";
  $("saveCatalogBtn").textContent = "Afegir al catàleg";
  $("cancelCatalogBtn").classList.add("hidden");
  $("catalogMessage").textContent = "";
}
function renderCatalog() {
  const container = $("catalogList");
  if (!container) return;
  container.innerHTML = "";
  if (!catalog.length) {
    container.innerHTML = '<div class="empty">Encara no hi ha productes al catàleg. Afegeix-ne el primer.</div>';
  } else {
    catalog.forEach(item => {
      const card = document.createElement("article");
      card.className = "catalog-item";
      const info = document.createElement("div");
      const name = document.createElement("div");
      name.className = "catalog-name";
      name.textContent = item.name;
      const desc = document.createElement("div");
      desc.className = "catalog-desc";
      desc.textContent = item.description || "Sense descripció";
      const prices = document.createElement("div");
      prices.className = "catalog-prices";
      const price = document.createElement("strong");
      price.textContent = `Venda: ${money(item.price)}`;
      const cost = document.createElement("span");
      cost.textContent = `Cost: ${money(item.cost)}`;
      prices.append(price, cost);
      const actions = document.createElement("div");
      actions.className = "catalog-actions";
      const edit = document.createElement("button");
      edit.className = "small-btn";
      edit.textContent = "Editar";
      edit.addEventListener("click", () => {
        $("catalogId").value = item.id;
        $("catalogName").value = item.name;
        $("catalogPrice").value = item.price ?? 0;
        $("catalogCost").value = item.cost ?? 0;
        $("catalogDescription").value = item.description || "";
        $("saveCatalogBtn").textContent = "Desar canvis";
        $("cancelCatalogBtn").classList.remove("hidden");
        $("catalogForm").scrollIntoView({behavior:"smooth", block:"center"});
      });
      const remove = document.createElement("button");
      remove.className = "small-btn";
      remove.textContent = "Eliminar";
      remove.addEventListener("click", async () => {
        if (!confirm(`Vols eliminar "${item.name}" del catàleg? Les comandes existents no canviaran.`)) return;
        try {
          await deleteDoc(doc(db, "products", item.id));
        } catch (err) {
          $("catalogMessage").textContent = `No s'ha pogut eliminar (${err.code || "error"}).`;
        }
      });
      actions.append(edit, remove);
      info.append(name, desc, actions);
      card.append(info, prices);
      container.appendChild(card);
    });
  }
  refreshProductSelects();
}
$("catalogForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (!auth.currentUser) return;
  const name = $("catalogName").value.trim();
  const data = {
    name,
    price: Math.max(0, Number($("catalogPrice").value) || 0),
    cost: Math.max(0, Number($("catalogCost").value) || 0),
    description: $("catalogDescription").value.trim(),
    updatedAt: serverTimestamp()
  };
  if (!name) return;
  $("saveCatalogBtn").disabled = true;
  $("catalogMessage").textContent = "Desant...";
  try {
    const id = $("catalogId").value;
    if (id) await updateDoc(doc(db, "products", id), data);
    else await addDoc(collection(db, "products"), {...data, createdAt: serverTimestamp()});
    resetCatalogForm();
    $("catalogMessage").textContent = "Producte desat correctament.";
  } catch (err) {
    console.error(err);
    $("catalogMessage").textContent = `No s'ha pogut desar (${err.code || "error"}).`;
  } finally {
    $("saveCatalogBtn").disabled = false;
  }
});
$("cancelCatalogBtn").addEventListener("click", resetCatalogForm);

function readProducts() {
  return [...$("products").querySelectorAll(".product-row")].map(row => ({
    name: row.querySelector(".p-name").value || "Altres",
    quantity: Math.max(1, Math.floor(Number(row.querySelector(".p-qty").value) || 1)),
    unitPrice: Math.max(0, Number(row.querySelector(".p-price").value) || 0),
    unitCost: Math.max(0, Number(row.querySelector(".p-cost").value) || 0),
    notes: row.querySelector(".p-notes").value.trim()
  }));
}
function totals(products = readProducts()) {
  const productSubtotal = products.reduce((s,p) => s + p.quantity*p.unitPrice, 0);
  const extras = Math.max(0, Number($("shipping").value) || 0);
  const subtotal = productSubtotal + extras;
  const vatRate = Math.max(0, Number($("vat").value) || 0) / 100;
  const vatAmount = subtotal * vatRate;
  const total = subtotal + vatAmount;
  const productCost = products.reduce((s,p) => s + p.quantity*p.unitCost, 0);
  const laborHours = Math.max(0, Number($("laborHours").value) || 0);
  const hourlyRate = Math.max(0, Number($("hourlyRate").value) || 0);
  const laborCost = laborHours * hourlyRate;
  const otherCosts = Math.max(0, Number($("otherCosts").value) || 0);
  const fullCost = productCost + laborCost + otherCosts;
  const deposit = Math.max(0, Number($("deposit").value) || 0);
  const margin = subtotal - fullCost;
  const marginPercent = subtotal > 0 ? margin / subtotal * 100 : 0;
  return {subtotal, vatRate: vatRate, vatAmount, total, cost: productCost, laborHours, hourlyRate, laborCost, otherCosts, fullCost, margin, marginPercent, outstanding: total-deposit};
}
function updateTotals() {
  const t = totals();
  $("subtotal").textContent = money(t.subtotal);
  $("vatAmount").textContent = money(t.vatAmount);
  $("grandTotal").textContent = money(t.total);
  $("costTotal").textContent = money(t.cost);
  $("laborTotal").textContent = money(t.laborCost);
  $("otherCostTotal").textContent = money(t.otherCosts);
  $("fullCostTotal").textContent = money(t.fullCost);
  $("margin").textContent = money(t.margin);
  $("marginPercent").textContent = `${t.marginPercent.toLocaleString("ca-ES", {minimumFractionDigits:1, maximumFractionDigits:1})}%`;
  $("outstanding").textContent = money(t.outstanding);
}
["shipping","vat","deposit","laborHours","hourlyRate","otherCosts"].forEach(id => $(id).addEventListener("input", updateTotals));

function resetForm() {
  $("orderForm").reset();
  $("orderClientId").value = "";
  $("orderId").value = "";
  $("formTitle").textContent = "Nova comanda";
  $("saveBtn").textContent = "Desar comanda";
  $("cancelEditBtn").classList.add("hidden");
  $("products").innerHTML = "";
  productCounter = 0;
  addProductRow();
  $("formMessage").textContent = "";
}
function formData() {
  const products = readProducts();
  const t = totals(products);
  return {
    client: $("client").value.trim(),
    clientId: $("orderClientId").value || null,
    contact: $("contact").value.trim(),
    eventType: $("eventType").value,
    dueDate: $("dueDate").value || "",
    status: $("status").value,
    deposit: Math.max(0, Number($("deposit").value) || 0),
    extraCharges: Math.max(0, Number($("shipping").value) || 0),
    laborHours: t.laborHours,
    hourlyRate: t.hourlyRate,
    laborCost: Number(t.laborCost.toFixed(2)),
    otherCosts: t.otherCosts,
    vatRate: t.vatRate,
    products,
    subtotal: Number(t.subtotal.toFixed(2)),
    vatAmount: Number(t.vatAmount.toFixed(2)),
    total: Number(t.total.toFixed(2)),
    estimatedCost: Number(t.fullCost.toFixed(2)),
    productCost: Number(t.cost.toFixed(2)),
    estimatedLaborCost: Number(t.laborCost.toFixed(2)),
    estimatedOtherCosts: Number(t.otherCosts.toFixed(2)),
    estimatedMargin: Number(t.margin.toFixed(2)),
    estimatedMarginPercent: Number(t.marginPercent.toFixed(2)),
    outstanding: Number(t.outstanding.toFixed(2)),
    notes: $("notes").value.trim(),
    updatedAt: serverTimestamp()
  };
}
function matchSavedClientByName(name) { return clients.find(c => (c.name || "").trim().toLocaleLowerCase("ca") === (name || "").trim().toLocaleLowerCase("ca")); }
function syncOrderClientSelection() {
  const name = $("client").value.trim();
  const client = matchSavedClientByName(name);
  $("orderClientId").value = client?.id || "";
  if (client) {
    const contact = [client.email, client.phone].filter(Boolean).join(" · ");
    $("contact").value = contact;
  }
}
$("client").addEventListener("input", () => { $("orderClientId").value = ""; });
$("client").addEventListener("change", syncOrderClientSelection);
$("client").addEventListener("blur", syncOrderClientSelection);

$("loginForm").addEventListener("submit", async e => {
  e.preventDefault(); showError("");
  try {
    await signInWithEmailAndPassword(auth, $("email").value.trim(), $("password").value);
    $("password").value = "";
  } catch (err) {
    showError(err.code === "auth/invalid-credential" ? "Correu o contrasenya incorrectes." : `No s'ha pogut iniciar sessió (${err.code || "error"}).`);
  }
});
$("logoutBtn").addEventListener("click", () => signOut(auth));
$("addProductBtn").addEventListener("click", () => addProductRow());
$("cancelEditBtn").addEventListener("click", resetForm);
$("orderForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (!auth.currentUser) return;
  $("saveBtn").disabled = true;
  $("formMessage").textContent = "Desant...";
  try {
    const data = formData();
    if (!data.client) throw new Error("Escriu el nom del client.");
    const id = $("orderId").value;
    if (id) {
      await updateDoc(doc(db, "orders", id), data);
      $("formMessage").textContent = "Comanda actualitzada correctament.";
    } else {
      data.createdAt = serverTimestamp();
      const ref = await addDoc(collection(db, "orders"), data);
      $("formMessage").textContent = `Comanda desada (${ref.id.slice(0,8)}).`;
    }
    resetForm();
    $("formMessage").textContent = "Canvis desats correctament.";
  } catch (err) {
    console.error(err);
    $("formMessage").textContent = err.code === "permission-denied"
      ? "Accés denegat. Revisa les regles de Firestore i que l'UID sigui correcte."
      : `No s'ha pogut desar: ${err.message || err.code || "error"}`;
  } finally { $("saveBtn").disabled = false; }
});
function editOrder(order) {
  $("orderId").value = order.id;
  $("formTitle").textContent = "Editar comanda";
  $("saveBtn").textContent = "Desar canvis";
  $("cancelEditBtn").classList.remove("hidden");
  $("client").value = order.client || "";
  $("orderClientId").value = order.clientId || "";
  $("contact").value = order.contact || "";
  $("eventType").value = order.eventType || "Particular";
  $("dueDate").value = order.dueDate || "";
  $("status").value = order.status || statuses[0];
  $("deposit").value = order.deposit ?? 0;
  $("shipping").value = order.extraCharges ?? 0;
  $("laborHours").value = order.laborHours ?? 0;
  $("hourlyRate").value = order.hourlyRate ?? 0;
  $("otherCosts").value = order.otherCosts ?? 0;
  $("vat").value = String(Math.round((order.vatRate ?? .21)*100));
  $("notes").value = order.notes || "";
  $("products").innerHTML = "";
  productCounter = 0;
  (order.products?.length ? order.products : [{}]).forEach(p => addProductRow(p));
  updateTotals();
  $("orderForm").scrollIntoView({behavior:"smooth",block:"start"});
}
function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}
function formatDate(value) {
  if (!value) return "—";
  const parts = String(value).split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : escapeHtml(value);
}
function createQuotePdf(order, language = "ca") {
  const es = language === "es";
  const products = Array.isArray(order.products) ? order.products : [];
  const subtotal = Number(order.subtotal ?? products.reduce((s,p)=>s+(Number(p.quantity)||0)*(Number(p.unitPrice)||0),0) + (Number(order.extraCharges)||0));
  const vatRate = Number(order.vatRate ?? 0.21);
  const vatAmount = Number(order.vatAmount ?? subtotal*vatRate);
  const total = Number(order.total ?? subtotal+vatAmount);
  const locale = es ? "es-ES" : "ca-ES";
  const t = es ? {
    quote:"PRESUPUESTO", date:"Fecha", prepared:"Preparado para", client:"Cliente", event:"Encargo personalizado",
    details:"Detalles del encargo", due:"Fecha límite de entrega", reference:"Referencia", description:"Descripción y precios",
    product:"Producto / servicio", quantity:"Cant.", unit:"Precio unitario", amount:"Importe", custom:"Producto o servicio personalizado",
    extras:"Otros gastos repercutidos", subtotal:"Subtotal", vat:"IVA", total:"TOTAL", notes:"OBSERVACIONES Y CONDICIONES",
    footer:"LightCut Studio · Presupuesto orientativo según los detalles indicados", print:"Para guardar el documento en PDF, selecciona «Guardar como PDF» en la ventana de impresión.",
    popup:"El navegador ha bloqueado la ventana del presupuesto. Permite las ventanas emergentes para este sitio y vuelve a intentarlo.",
    title:"Presupuesto", productDefault:"Producto personalizado"
  } : {
    quote:"PRESSUPOST", date:"Data", prepared:"Preparat per a", client:"Client", event:"Encàrrec personalitzat",
    details:"Detalls de l'encàrrec", due:"Data límit d'entrega", reference:"Referència", description:"Descripció i preus",
    product:"Producte / servei", quantity:"Quant.", unit:"Preu unitari", amount:"Import", custom:"Producte o servei personalitzat",
    extras:"Altres despeses repercutides", subtotal:"Subtotal", vat:"IVA", total:"TOTAL", notes:"OBSERVACIONS I CONDICIONS",
    footer:"LightCut Studio · Pressupost orientatiu segons els detalls indicats", print:"Per desar el document en PDF, selecciona «Desa com a PDF» a la finestra d'impressió.",
    popup:"El navegador ha bloquejat la finestra del pressupost. Permet les finestres emergents per a aquest lloc i torna-ho a provar.",
    title:"Pressupost", productDefault:"Producte personalitzat"
  };
  const moneyPdf = value => Number(value || 0).toLocaleString(locale, {style:"currency",currency:"EUR"});
  const rows = products.map(p => `<tr><td>${escapeHtml(p.name || t.productDefault)}${p.notes ? `<div class="detail">${escapeHtml(p.notes)}</div>` : ""}</td><td class="num">${Number(p.quantity)||0}</td><td class="num">${moneyPdf(p.unitPrice)}</td><td class="num">${moneyPdf((Number(p.quantity)||0)*(Number(p.unitPrice)||0))}</td></tr>`).join("");
  const extra = Number(order.extraCharges ?? order.shipping ?? 0);
  const notes = String(order.notes || "").trim();
  const issueDate = new Date().toLocaleDateString(locale);
  const docNo = `LCS-${String(order.id || "").slice(0,8).toUpperCase()}`;
  const html = `<!doctype html><html lang="${es ? "es" : "ca"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t.title} ${docNo} — LightCut Studio</title><style>
    @page{size:A4;margin:18mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#242424;margin:0;font-size:12px;line-height:1.5}header{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid #b7a17a;padding-bottom:20px;margin-bottom:28px}.brand{font-size:23px;letter-spacing:2px;font-weight:700}.subbrand{color:#777;font-size:10px;letter-spacing:2px;margin-top:3px}.doctype{text-align:right}.doctype h1{font-size:23px;letter-spacing:2px;margin:0 0 5px}.muted{color:#777}.details{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:26px}.label{font-size:9px;letter-spacing:1.4px;color:#8a795d;text-transform:uppercase;font-weight:700;margin-bottom:5px}.client{font-size:16px;font-weight:700}.event{margin-top:5px;color:#666}table{width:100%;border-collapse:collapse;margin:18px 0 20px}thead{background:#f3f0e9}th{text-align:left;font-size:10px;letter-spacing:.5px;color:#5f513c;padding:10px 8px}td{padding:11px 8px;border-bottom:1px solid #e8e5df;vertical-align:top}td.num,th.num{text-align:right;white-space:nowrap}.detail{color:#777;font-size:10px;margin-top:3px}.summary{width:52%;margin-left:auto}.summary div{display:flex;justify-content:space-between;padding:6px 0}.summary .total{font-size:16px;font-weight:700;border-top:2px solid #b7a17a;margin-top:5px;padding-top:12px}.notes{margin-top:28px;padding:14px;background:#f7f6f2;white-space:pre-wrap}.notes strong{display:block;font-size:10px;letter-spacing:1px;margin-bottom:5px}.footer{border-top:1px solid #ddd;margin-top:38px;padding-top:12px;color:#888;font-size:9px;display:flex;justify-content:space-between}.print-hint{margin:0 0 16px;padding:10px;background:#f7f6f2;color:#666;font-size:11px}@media print{.print-hint{display:none}}@media screen{body{max-width:800px;margin:24px auto;padding:24px;box-shadow:0 2px 25px #0001}.print-hint{display:block}}
    </style></head><body><div class="print-hint">${t.print}</div>
    <header><div><div class="brand">LIGHTCUT STUDIO</div><div class="subbrand">DISEÑO · CORTE Y GRABADO LÁSER</div></div><div class="doctype"><h1>${t.quote}</h1><div><b>${docNo}</b></div><div class="muted">${t.date}: ${issueDate}</div></div></header>
    <section class="details"><div><div class="label">${t.prepared}</div><div class="client">${escapeHtml(order.client || t.client)}</div>${order.contact ? `<div>${escapeHtml(order.contact)}</div>` : ""}<div class="event">${escapeHtml(order.eventType || t.event)}</div></div><div><div class="label">${t.details}</div><div>${t.due}: <b>${formatDate(order.dueDate)}</b></div><div>${t.reference}: ${escapeHtml(String(order.id || "").slice(0,8).toUpperCase())}</div></div></section>
    <div class="label">${t.description}</div><table><thead><tr><th>${t.product}</th><th class="num">${t.quantity}</th><th class="num">${t.unit}</th><th class="num">${t.amount}</th></tr></thead><tbody>${rows || `<tr><td colspan="4">${t.custom}</td></tr>`}${extra ? `<tr><td>${t.extras}</td><td class="num">1</td><td class="num">${moneyPdf(extra)}</td><td class="num">${moneyPdf(extra)}</td></tr>` : ""}</tbody></table>
    <section class="summary"><div><span>${t.subtotal}</span><span>${moneyPdf(subtotal)}</span></div><div><span>${t.vat} (${(vatRate*100).toLocaleString(locale)}%)</span><span>${moneyPdf(vatAmount)}</span></div><div class="total"><span>${t.total}</span><span>${moneyPdf(total)}</span></div></section>
    ${notes ? `<section class="notes"><strong>${t.notes}</strong>${escapeHtml(notes)}</section>` : ""}
    <footer class="footer"><span>${t.footer}</span><span>${docNo}</span></footer>
    <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),350));<\/script></body></html>`;
  const popup = window.open("", "_blank");
  if (!popup) { alert(t.popup); return; }
  popup.document.open(); popup.document.write(html); popup.document.close();
}

function getOrderDate(order) {
  const value = order.createdAt || order.updatedAt;
  if (value && typeof value.toDate === "function") return value.toDate();
  if (value && typeof value.seconds === "number") return new Date(value.seconds * 1000);
  if (value instanceof Date) return value;
  return null;
}
function renderFinance() {
  const now = new Date();
  const period = $("financePeriod")?.value || "month";
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  if (period === "30" || period === "90") {
    start.setTime(now.getTime());
    start.setDate(start.getDate() - Number(period) + 1);
    start.setHours(0,0,0,0);
  } else if (period === "year") {
    start.setFullYear(now.getFullYear(), 0, 1);
  }
  const inPeriod = orders.filter(o => {
    if (period === "all") return true;
    const date = getOrderDate(o);
    return date && date >= start && date <= now;
  });
  const active = inPeriod.filter(o => o.status !== "Cancel·lada");
  const num = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
  const revenueOf = o => num(o.subtotal ?? (num(o.total) / (1 + num(o.vatRate ?? .21))));
  const costsOf = o => num(o.estimatedCost ?? (num(o.productCost) + num(o.estimatedLaborCost) + num(o.estimatedOtherCosts)));
  const profitOf = o => num(o.estimatedMargin ?? (revenueOf(o) - costsOf(o)));
  const revenue = active.reduce((sum,o) => sum + revenueOf(o), 0);
  const costs = active.reduce((sum,o) => sum + costsOf(o), 0);
  const profit = active.reduce((sum,o) => sum + profitOf(o), 0);
  const deposits = active.reduce((sum,o) => sum + num(o.deposit), 0);
  const pending = active.reduce((sum,o) => sum + Math.max(0, num(o.total) - num(o.deposit)), 0);
  const margin = revenue > 0 ? profit / revenue * 100 : 0;
  $("finRevenue").textContent = money(revenue);
  $("finCosts").textContent = money(costs);
  $("finProfit").textContent = money(profit);
  $("finProfit").style.color = profit < 0 ? "var(--danger)" : "var(--accent)";
  $("finMargin").textContent = `${margin.toLocaleString("ca-ES", {minimumFractionDigits:1, maximumFractionDigits:1})}%`;
  $("finDeposits").textContent = money(deposits);
  $("finPending").textContent = money(pending);
  $("finOrders").textContent = String(active.length);
  $("finAverage").textContent = money(active.length ? revenue / active.length : 0);
  $("finDelivered").textContent = String(active.filter(o => o.status === "Entregada").length);
  $("finCancelled").textContent = String(inPeriod.filter(o => o.status === "Cancel·lada").length);

  const chart = $("financeChart");
  chart.innerHTML = "";
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({date, key: `${date.getFullYear()}-${date.getMonth()}`, revenue: 0, profit: 0});
  }
  const chartOrders = active.filter(o => {
    const date = getOrderDate(o);
    if (!date) return false;
    return months.some(m => m.key === `${date.getFullYear()}-${date.getMonth()}`);
  });
  chartOrders.forEach(o => {
    const date = getOrderDate(o);
    const month = months.find(m => m.key === `${date.getFullYear()}-${date.getMonth()}`);
    if (month) { month.revenue += revenueOf(o); month.profit += profitOf(o); }
  });
  const maxValue = Math.max(1, ...months.map(m => Math.max(m.revenue, m.profit)));
  if (!chartOrders.length) {
    chart.innerHTML = '<p class="finance-empty">No hi ha comandes amb data en els últims sis mesos.</p>';
  } else {
    months.forEach(m => {
      const column = document.createElement("div"); column.className = "finance-month";
      const bars = document.createElement("div"); bars.className = "finance-bars";
      const sales = document.createElement("div"); sales.className = "finance-bar sales";
      sales.style.height = `${Math.max(m.revenue > 0 ? 3 : 0, m.revenue / maxValue * 100)}%`;
      sales.title = `Vendes ${m.date.toLocaleDateString("ca-ES", {month:"long",year:"numeric"})}: ${money(m.revenue)}`;
      const prof = document.createElement("div"); prof.className = "finance-bar profit";
      prof.style.height = `${Math.max(m.profit > 0 ? 3 : 0, Math.max(0,m.profit) / maxValue * 100)}%`;
      prof.title = `Benefici estimat: ${money(m.profit)}`;
      bars.append(sales, prof);
      const label = document.createElement("span"); label.className = "finance-month-label";
      label.textContent = m.date.toLocaleDateString("ca-ES", {month:"short"}).replace(".","");
      column.append(bars, label); chart.appendChild(column);
    });
  }
}
$("financePeriod")?.addEventListener("change", renderFinance);

function renderOrders() {
  const search = $("search").value.trim().toLocaleLowerCase("ca");
  const filter = $("statusFilter").value;
  const shown = orders.filter(o => (!filter || o.status === filter) &&
    `${o.id} ${o.client || ""} ${o.contact || ""} ${o.eventType || ""}`.toLocaleLowerCase("ca").includes(search));
  $("ordersList").innerHTML = "";
  if (!shown.length) {
    $("ordersList").innerHTML = '<div class="empty">Encara no hi ha comandes que coincideixin amb la cerca.</div>';
  } else {
    shown.forEach(o => {
      const card = document.createElement("article");
      card.className = "order-card";
      const left = document.createElement("div");
      const title = document.createElement("div"); title.className = "order-title"; title.textContent = o.client || "Client sense nom";
      const meta = document.createElement("div"); meta.className = "order-meta";
      meta.textContent = `${o.eventType || "Encàrrec"} · ${o.dueDate ? "Entrega: "+o.dueDate : "Sense data límit"} · ${o.id.slice(0,8)}`;
      const statusWrap = document.createElement("div");
      statusWrap.className = "order-status-control";
      const statusLabel = document.createElement("label");
      statusLabel.textContent = "Estat de la comanda";
      statusLabel.className = "order-status-label";
      const statusSelect = document.createElement("select");
      statusSelect.className = "order-status-select";
      statusSelect.setAttribute("aria-label", `Canviar estat de la comanda de ${o.client || "client sense nom"}`);
      statuses.forEach(status => {
        const option = document.createElement("option");
        option.value = status;
        option.textContent = status;
        statusSelect.appendChild(option);
      });
      statusSelect.value = statuses.includes(o.status) ? o.status : statuses[0];
      statusSelect.addEventListener("change", async () => {
        const newStatus = statusSelect.value;
        statusSelect.disabled = true;
        try {
          await updateDoc(doc(db, "orders", o.id), {status: newStatus, updatedAt: serverTimestamp()});
        } catch (err) {
          console.error("No s'ha pogut canviar l'estat de la comanda:", err);
          statusSelect.value = statuses.includes(o.status) ? o.status : statuses[0];
          alert(`No s'ha pogut canviar l'estat (${err.code || "error"}). Comprova la connexió i els permisos de Firebase.`);
        } finally {
          statusSelect.disabled = false;
        }
      });
      statusWrap.append(statusLabel, statusSelect);
      left.append(title, meta, statusWrap);
      const right = document.createElement("div"); right.className = "order-right";
      const price = document.createElement("div"); price.className = "order-price"; price.textContent = money(o.total);
      const actions = document.createElement("div"); actions.className = "order-actions";
      const quote = document.createElement("button"); quote.className = "small-btn"; quote.textContent = "Pressupost PDF"; quote.addEventListener("click", () => { const spanish = confirm("Vols generar el pressupost en castellà?\n\nAccepta: castellà · Cancel·la: català"); createQuotePdf(o, spanish ? "es" : "ca"); });
      const invoice = document.createElement("button"); invoice.className = "small-btn"; invoice.textContent = "Crear factura"; invoice.addEventListener("click", () => { fillClientSelects(); $("invoiceOrder").value = o.id; $("invoiceOrder").dispatchEvent(new Event("change")); $("invoicesPanel").scrollIntoView({behavior:"smooth",block:"start"}); });
      const edit = document.createElement("button"); edit.className = "small-btn"; edit.textContent = "Editar"; edit.addEventListener("click", () => editOrder(o));
      const removeOrder = document.createElement("button"); removeOrder.className = "small-btn"; removeOrder.textContent = "Eliminar"; removeOrder.addEventListener("click", async () => {
        if (!confirm(`Vols eliminar la comanda de ${o.client || "client"}? Aquesta acció no es pot desfer.`)) return;
        try { await deleteDoc(doc(db, "orders", o.id)); }
        catch (err) { alert(`No s'ha pogut eliminar la comanda (${err.code || "error"}).`); }
      });
      actions.append(quote, invoice, edit, removeOrder); right.append(price, actions); card.append(left,right); $("ordersList").append(card);
    });
  }
  $("statCount").textContent = String(orders.length);
  $("statActive").textContent = String(orders.filter(o => ["Confirmada","En producció","Llista per entregar"].includes(o.status)).length);
  $("statTotal").textContent = money(orders.filter(o => o.status !== "Cancel·lada").reduce((s,o)=>s+(Number(o.total)||0),0));
  renderFinance();
}
$("search").addEventListener("input", renderOrders);
$("statusFilter").addEventListener("change", renderOrders);

onAuthStateChanged(auth, user => {
  $("loginPanel").classList.toggle("hidden", !!user);
  $("appPanel").classList.toggle("hidden", !user);
  $("logoutBtn").classList.toggle("hidden", !user);
  if (unsubscribeOrders) { unsubscribeOrders(); unsubscribeOrders = null; }
  if (unsubscribeCatalog) { unsubscribeCatalog(); unsubscribeCatalog = null; }
  if (unsubClients) { unsubClients(); unsubClients=null; }
  if (unsubInvoices) { unsubInvoices(); unsubInvoices=null; }
  if (unsubSettings) { unsubSettings(); unsubSettings=null; }
  orders = [];
  catalog = []; clients=[]; invoices=[];
  renderOrders();
  renderCatalog();
  if (user) {
    unsubClients = onSnapshot(query(collection(db,'clients'), orderBy('name')), snap=>{clients=snap.docs.map(d=>({id:d.id,...d.data()}));renderClients();syncOrderClientSelection();},err=>{$('clientsList').innerHTML=`<div class="empty">No es poden carregar clients (${err.code||'error'}).</div>`;});
    unsubInvoices = onSnapshot(query(collection(db,'invoices'), orderBy('sequence')), snap=>{invoices=snap.docs.map(d=>({id:d.id,...d.data()}));renderInvoices();},err=>{$('invoicesList').innerHTML=`<div class="empty">No es poden carregar factures (${err.code||'error'}).</div>`;});
    unsubSettings = onSnapshot(doc(db,'settings','fiscal'), snap=>{fiscalSettings=snap.exists()?snap.data():{};populateFiscalForm();},err=>console.warn('Fiscal settings',err));
    unsubscribeCatalog = onSnapshot(query(collection(db, "products"), orderBy("name")), snapshot => {
      catalog = snapshot.docs.map(d => ({id:d.id, ...d.data()}));
      renderCatalog();
    }, err => {
      console.error(err);
      $("catalogList").innerHTML = `<div class="empty">No es pot carregar el catàleg (${err.code || "error"}).</div>`;
    });
    $("ordersList").innerHTML = '<p class="muted">Carregant comandes...</p>';
    const q = query(collection(db, "orders"), orderBy("createdAt", "desc"));
    unsubscribeOrders = onSnapshot(q, snapshot => {
      orders = snapshot.docs.map(d => ({id:d.id, ...d.data()}));
      renderOrders(); fillClientSelects();
    }, err => {
      console.error(err);
      $("ordersList").innerHTML = `<div class="empty">No es poden carregar les comandes. Revisa les regles de Firestore. (${err.code || "error"})</div>`;
    });
  }
});
addProductRow();

// Clients, factures i configuració fiscal
let clients = [], invoices = [], fiscalSettings = {};
let unsubClients = null, unsubInvoices = null, unsubSettings = null;
function safeText(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fillClientSelects() {
  const clientInput = $('savedClients');
  if (clientInput) clientInput.innerHTML = clients.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||'')).map(c=>`<option value="${safeText(c.name)}"></option>`).join('');
  const current = $('invoiceClient').value;
  $('invoiceClient').innerHTML = '<option value="">Selecciona un client...</option>' + clients.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||'')).map(c=>`<option value="${c.id}">${safeText(c.name)}</option>`).join('');
  if (clients.some(c=>c.id===current)) $('invoiceClient').value=current;
  const orderCurrent=$('invoiceOrder').value;
  $('invoiceOrder').innerHTML='<option value="">Factura manual</option>'+orders.filter(o=>o.status!=='Cancel·lada').map(o=>`<option value="${o.id}">${safeText(o.client)} · ${money(o.total)}</option>`).join('');
  if (orders.some(o=>o.id===orderCurrent)) $('invoiceOrder').value=orderCurrent;
}
function renderClients() {
  const term=($('clientSearch')?.value||'').toLowerCase();
  const filtered=clients.filter(c=>[c.name,c.taxId,c.email,c.phone].join(' ').toLowerCase().includes(term));
  $('clientsList').innerHTML=filtered.length?filtered.map(c=>`<article class="catalog-item"><div><div class="catalog-name">${safeText(c.name)}</div><div class="catalog-desc">${safeText(c.taxId||'Sense NIF')} · ${safeText(c.email||'Sense correu')} · ${safeText(c.phone||'Sense telèfon')}<br>${orders.filter(o=>(o.clientId===c.id||o.client===c.name)&&o.status!=='Pendent de confirmar'&&o.status!=='Cancel·lada').length} comandes confirmades · ${invoices.filter(i=>i.clientId===c.id).length} factures</div></div><div class="catalog-actions"><button class="small-btn" data-edit-client="${c.id}">Editar</button><button class="small-btn" data-client-orders="${c.id}">Historial</button><button class="small-btn" data-invoice-client="${c.id}">Nova factura</button></div></article>`).join(''):'<div class="empty">Encara no hi ha clients desats.</div>';
  $('clientsList').querySelectorAll('[data-edit-client]').forEach(b=>b.onclick=()=>editClient(clients.find(c=>c.id===b.dataset.editClient)));
  $('clientsList').querySelectorAll('[data-invoice-client]').forEach(b=>{b.onclick=()=>{$('invoiceClient').value=b.dataset.invoiceClient;$('invoicesPanel').scrollIntoView({behavior:'smooth'});};});
  $('clientsList').querySelectorAll('[data-client-orders]').forEach(b=>{b.onclick=()=>{const c=clients.find(x=>x.id===b.dataset.clientOrders);$('search').value=c?.name||'';$('ordersPanel').scrollIntoView({behavior:'smooth'});renderOrders();};});
  fillClientSelects();
}
function resetClientForm(){ $('clientForm').reset(); $('clientId').value=''; $('clCountry').value='Espanya'; $('saveClientBtn').textContent='Desar client'; $('cancelClientBtn').classList.add('hidden'); }
function editClient(c){if(!c)return; $('clientId').value=c.id; $('clName').value=c.name||''; $('clTaxId').value=c.taxId||''; $('clEmail').value=c.email||''; $('clPhone').value=c.phone||''; $('clAddress').value=c.address||''; $('clZip').value=c.zip||''; $('clCity').value=c.city||''; $('clCountry').value=c.country||'Espanya'; $('clNotes').value=c.notes||''; $('saveClientBtn').textContent='Desar canvis'; $('cancelClientBtn').classList.remove('hidden'); $('clientsPanel').scrollIntoView({behavior:'smooth'}); }
$('clientForm').addEventListener('submit',async e=>{e.preventDefault();if(!auth.currentUser)return;const data={name:$('clName').value.trim(),taxId:$('clTaxId').value.trim(),email:$('clEmail').value.trim(),phone:$('clPhone').value.trim(),address:$('clAddress').value.trim(),zip:$('clZip').value.trim(),city:$('clCity').value.trim(),country:$('clCountry').value.trim(),notes:$('clNotes').value.trim(),updatedAt:serverTimestamp()};try{const id=$('clientId').value;if(id)await updateDoc(doc(db,'clients',id),data);else{data.createdAt=serverTimestamp();await addDoc(collection(db,'clients'),data);}resetClientForm();$('clientMessage').textContent='Client desat correctament.';}catch(err){$('clientMessage').textContent=`No s'ha pogut desar el client (${err.code||err.message}).`;}});
$('cancelClientBtn').addEventListener('click',resetClientForm); $('clientSearch').addEventListener('input',renderClients);
function invoiceNumbers(){const nums=invoices.map(i=>Number(i.sequence)||0);return Math.max(53,...nums)+1;}
function updateInvoicePreview(){const base=Math.max(0,Number($('invoiceBase').value)||0),vat=Math.max(0,Number($('invoiceVat').value)||0),deposit=Math.max(0,Number($('invoiceDeposit').value)||0),tax=Number((base*vat/100).toFixed(2)),total=Number((base+tax).toFixed(2));$('invoiceBasePreview').textContent=money(base);$('invoiceVatPreview').textContent=money(tax);$('invoiceTotalPreview').textContent=money(total);$('invoicePendingPreview').textContent=money(Math.max(0,total-deposit));}
['invoiceBase','invoiceVat','invoiceDeposit'].forEach(id=>$(id).addEventListener('input',updateInvoicePreview));
$('invoiceOrder').addEventListener('change',()=>{const o=orders.find(x=>x.id===$('invoiceOrder').value);if(!o)return;let client=clients.find(c=>c.id===o.clientId)||clients.find(c=>c.name===o.client);if(client)$('invoiceClient').value=client.id;$('invoiceDate').value=new Date().toISOString().slice(0,10);$('invoiceVat').value=String(o.vatRate??21);$('invoiceBase').value=Number(o.subtotal??(Number(o.total||0)/(1+(Number(o.vatRate??21)/100)))).toFixed(2);$('invoiceDeposit').value=Number(o.deposit||0).toFixed(2);$('invoiceDescription').value=(o.products||[]).map(p=>`${p.name||'Producte'} × ${p.quantity||1}${p.notes?' — '+p.notes:''}`).join('\n')+(o.notes?'\n'+o.notes:'');updateInvoicePreview();});
function invoicePdf(inv){const client=clients.find(c=>c.id===inv.clientId)||{};const s=fiscalSettings||{};const base=Number(inv.base)||0,vat=Number(inv.vatRate)||0,tax=Number((base*vat/100).toFixed(2)),total=Number((base+tax).toFixed(2));const win=window.open('','_blank');if(!win){alert('Permet les finestres emergents per generar el PDF.');return;}win.document.write(`<!doctype html><html lang="ca"><meta charset="utf-8"><title>Factura ${safeText(inv.number)}</title><style>body{font:13px Arial,sans-serif;color:#222;max-width:800px;margin:35px auto;padding:25px}header{display:flex;justify-content:space-between;border-bottom:3px solid #b7a17a;padding-bottom:20px}h1{letter-spacing:3px}small{color:#777}.cols{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin:30px 0}.box{white-space:pre-line}table{width:100%;border-collapse:collapse;margin:25px 0}td,th{padding:12px;border-bottom:1px solid #ddd;text-align:left}.right{text-align:right}.total{font-size:18px;font-weight:bold;border-top:2px solid #b7a17a;padding-top:12px}.desc{white-space:pre-line;min-height:60px}@media print{button{display:none}}</style><header><div><strong style="font-size:22px;letter-spacing:2px">LIGHTCUT STUDIO</strong><br><small>Custom laser cut & engrave</small><p>${safeText(s.name||'')}<br>${safeText(s.taxId||'')}<br>${safeText(s.address||'')}<br>${safeText([s.zip,s.city,s.country].filter(Boolean).join(' '))}<br>${safeText(s.email||'')} ${safeText(s.phone||'')}</p></div><div class="right"><h1>FACTURA</h1><strong>${safeText(inv.number)}</strong><p>Data: ${safeText(inv.date)}</p></div></header><div class="cols"><div class="box"><small>FACTURAR A</small><br><strong>${safeText(client.name||'')}</strong><br>${safeText(client.taxId||'')}<br>${safeText(client.address||'')}<br>${safeText([client.zip,client.city,client.country].filter(Boolean).join(' '))}<br>${safeText(client.email||'')}</div><div><small>ESTAT</small><p>${safeText(inv.status||'Esborrany')}</p></div></div><table><thead><tr><th>Concepte</th><th class="right">Base</th><th class="right">IVA</th><th class="right">Import</th></tr></thead><tbody><tr><td class="desc">${safeText(inv.description)}</td><td class="right">${money(base)}</td><td class="right">${vat}% (${money(tax)})</td><td class="right">${money(total)}</td></tr></tbody></table><div style="margin-left:auto;max-width:320px"><p>Base imposable: <strong style="float:right">${money(base)}</strong></p><p>IVA: <strong style="float:right">${money(tax)}</strong></p><p class="total">Total: <span style="float:right">${money(total)}</span></p><p>Bestreta: <strong style="float:right">${money(inv.deposit||0)}</strong></p><p>Pendent: <strong style="float:right">${money(Math.max(0,total-(Number(inv.deposit)||0)))}</strong></p></div><div style="margin-top:25px;white-space:pre-line"><strong>Mètode de pagament:</strong> ${safeText(inv.paymentMethod||'No especificat')}<br><strong>Compte / IBAN:</strong> ${safeText(inv.account||'No especificat')}<br><strong>Condicions:</strong><br>${safeText(inv.terms||'No especificades')}</div><p style="margin-top:55px;color:#777;font-size:10px">${inv.status==='Esborrany'?'ESBORRANY — Aquest document no és una factura emesa.':'Factura marcada com a emesa per LightCut Studio.'}</p><button onclick="window.print()">Imprimir / Desa com a PDF</button></html>`);win.document.close();}
function renderInvoices(){$('invoicesList').innerHTML=invoices.length?invoices.slice().sort((a,b)=>(b.sequence||0)-(a.sequence||0)).map(i=>`<article class="catalog-item"><div><div class="catalog-name">${safeText(i.number)} · ${safeText(i.clientName||'Client')}</div><div class="catalog-desc">${safeText(i.date||'')} · ${money((Number(i.base)||0)*(1+(Number(i.vatRate)||0)/100))} · ${safeText(i.status||'Esborrany')}</div></div><div class="catalog-actions"><button class="small-btn" data-pdf-invoice="${i.id}">Vista / PDF</button>${(i.status||'Esborrany')==='Esborrany'?`<button class="small-btn primary" data-emit-invoice="${i.id}">Emetre factura</button><button class="small-btn" data-delete-invoice="${i.id}">Eliminar esborrany</button>`:''}</div></article>`).join(''):'<div class="empty">Encara no hi ha factures desades.</div>';$('invoicesList').querySelectorAll('[data-pdf-invoice]').forEach(b=>b.onclick=()=>invoicePdf(invoices.find(i=>i.id===b.dataset.pdfInvoice)));$('invoicesList').querySelectorAll('[data-emit-invoice]').forEach(b=>b.onclick=async()=>{const inv=invoices.find(i=>i.id===b.dataset.emitInvoice);if(!inv||inv.status!=='Esborrany')return;const client=clients.find(c=>c.id===inv.clientId);if(!client||!client.name||!client.taxId||!client.address||!fiscalSettings.name||!fiscalSettings.taxId||!fiscalSettings.address){alert('Abans d’emetre, completa les dades fiscals obligatòries del client i de LightCut Studio a Configuració.');return;}if(!inv.date||!inv.description||!(Number(inv.base)>0)){alert('Revisa la data, el concepte i la base imposable abans d’emetre.');return;}if(!confirm(`Vols emetre definitivament la factura ${inv.number}?

Després d’emetre-la no es podrà eliminar des de l’aplicació. Revisa les dades i la numeració abans de continuar.`))return;try{await updateDoc(doc(db,'invoices',inv.id),{status:'Emesa',issuedAt:serverTimestamp(),updatedAt:serverTimestamp()});alert(`Factura ${inv.number} marcada com a emesa. Obre Vista / PDF per imprimir-la o desar-la.`);}catch(err){alert(`No s’ha pogut emetre la factura (${err.code||err.message}).`);}});$('invoicesList').querySelectorAll('[data-delete-invoice]').forEach(b=>b.onclick=async()=>{const inv=invoices.find(i=>i.id===b.dataset.deleteInvoice);if(!inv||inv.status!=='Esborrany')return;if(!confirm(`Vols eliminar l'esborrany ${inv.number}?`))return;try{await deleteDoc(doc(db,'invoices',inv.id));}catch(err){alert(`No s'ha pogut eliminar (${err.code||'error'}).`);}});}
$('invoiceForm').addEventListener('submit',async e=>{e.preventDefault();if(!auth.currentUser)return;const client=clients.find(c=>c.id===$('invoiceClient').value);if(!client){$('invoiceMessage').textContent='Selecciona un client desat. Primer crea la seva fitxa.';return;}const base=Number($('invoiceBase').value)||0,vatRate=Number($('invoiceVat').value)||0,deposit=Number($('invoiceDeposit').value)||0;if(deposit>base*(1+vatRate/100)){$('invoiceMessage').textContent='La bestreta no pot superar el total de la factura.';return;}try{const seq=invoiceNumbers(),prefix=fiscalSettings.prefix||'F-';const inv={sequence:seq,number:`${prefix}${String(seq).padStart(4,'0')}`,clientId:client.id,clientName:client.name,orderId:$('invoiceOrder').value||null,date:$('invoiceDate').value,description:$('invoiceDescription').value.trim(),base:Number(base.toFixed(2)),vatRate,deposit:Number(deposit.toFixed(2)),paymentMethod:$('invoicePaymentMethod').value.trim(),account:$('invoiceAccount').value.trim(),terms:$('invoiceTerms').value.trim(),status:'Esborrany',createdAt:serverTimestamp(),updatedAt:serverTimestamp()};await addDoc(collection(db,'invoices'),inv);$('invoiceMessage').textContent=`Esborrany ${inv.number} desat.`;$('invoiceForm').reset();$('invoiceDate').value=new Date().toISOString().slice(0,10);$('invoiceBase').value='0';$('invoiceDeposit').value='0';$('invoicePaymentMethod').value='';$('invoiceAccount').value='';$('invoiceTerms').value='';updateInvoicePreview();}catch(err){$('invoiceMessage').textContent=`No s'ha pogut desar (${err.code||err.message}).`;}});
$('fiscalForm').addEventListener('submit',async e=>{e.preventDefault();try{fiscalSettings={name:$('fsName').value.trim(),taxId:$('fsTaxId').value.trim(),address:$('fsAddress').value.trim(),zip:$('fsZip').value.trim(),city:$('fsCity').value.trim(),country:$('fsCountry').value.trim(),email:$('fsEmail').value.trim(),phone:$('fsPhone').value.trim(),prefix:$('fsPrefix').value.trim()||'F-',updatedAt:serverTimestamp()};await updateDoc(doc(db,'settings','fiscal'),fiscalSettings).catch(async err=>{if(err.code==='not-found'||err.code==='firestore/not-found')await setDoc(doc(db,'settings','fiscal'),fiscalSettings);else throw err;});$('fiscalMessage').textContent='Dades fiscals desades.';}catch(err){$('fiscalMessage').textContent=`No s'han pogut desar les dades (${err.code||err.message}).`;}});
function populateFiscalForm(){const m={fsName:'name',fsTaxId:'taxId',fsAddress:'address',fsZip:'zip',fsCity:'city',fsCountry:'country',fsEmail:'email',fsPhone:'phone',fsPrefix:'prefix'};for(const [id,key] of Object.entries(m))$(id).value=fiscalSettings[key]??(key==='country'?'Espanya':key==='prefix'?'F-':'');}


const navToggle=$('navToggle'), sideNav=$('sideNav'), navBackdrop=$('navBackdrop');
function closeSideNav(){sideNav.classList.remove('open');navBackdrop.classList.add('hidden');navToggle.setAttribute('aria-expanded','false');}
function openSideNav(){sideNav.classList.add('open');navBackdrop.classList.remove('hidden');navToggle.setAttribute('aria-expanded','true');}
navToggle?.addEventListener('click',()=>sideNav.classList.contains('open')?closeSideNav():openSideNav());
$('navClose')?.addEventListener('click',closeSideNav);navBackdrop?.addEventListener('click',closeSideNav);
sideNav?.querySelectorAll('a').forEach(a=>a.addEventListener('click',closeSideNav));
window.addEventListener('keydown',e=>{if(e.key==='Escape')closeSideNav();});

$('invoiceDate').value=new Date().toISOString().slice(0,10); updateInvoicePreview();
