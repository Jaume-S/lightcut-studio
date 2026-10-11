import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import {
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot,
  query, orderBy, serverTimestamp
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
function createQuotePdf(order) {
  const products = Array.isArray(order.products) ? order.products : [];
  const subtotal = Number(order.subtotal ?? products.reduce((s,p)=>s+(Number(p.quantity)||0)*(Number(p.unitPrice)||0),0) + (Number(order.extraCharges)||0));
  const vatRate = Number(order.vatRate ?? 0.21);
  const vatAmount = Number(order.vatAmount ?? subtotal*vatRate);
  const total = Number(order.total ?? subtotal+vatAmount);
  const moneyPdf = value => Number(value || 0).toLocaleString("ca-ES", {style:"currency",currency:"EUR"});
  const rows = products.map(p => `<tr><td>${escapeHtml(p.name || "Producte personalitzat")}${p.notes ? `<div class="detail">${escapeHtml(p.notes)}</div>` : ""}</td><td class="num">${Number(p.quantity)||0}</td><td class="num">${moneyPdf(p.unitPrice)}</td><td class="num">${moneyPdf((Number(p.quantity)||0)*(Number(p.unitPrice)||0))}</td></tr>`).join("");
  const extra = Number(order.extraCharges ?? order.shipping ?? 0);
  const notes = String(order.notes || "").trim();
  const issueDate = new Date().toLocaleDateString("ca-ES");
  const docNo = `LCS-${String(order.id || "").slice(0,8).toUpperCase()}`;
  const html = `<!doctype html><html lang="ca"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pressupost ${docNo} — LightCut Studio</title><style>
    @page{size:A4;margin:18mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#242424;margin:0;font-size:12px;line-height:1.5}header{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid #b7a17a;padding-bottom:20px;margin-bottom:28px}.brand{font-size:23px;letter-spacing:2px;font-weight:700}.subbrand{color:#777;font-size:10px;letter-spacing:2px;margin-top:3px}.doctype{text-align:right}.doctype h1{font-size:23px;letter-spacing:2px;margin:0 0 5px}.muted{color:#777}.details{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:26px}.label{font-size:9px;letter-spacing:1.4px;color:#8a795d;text-transform:uppercase;font-weight:700;margin-bottom:5px}.client{font-size:16px;font-weight:700}.event{margin-top:5px;color:#666}table{width:100%;border-collapse:collapse;margin:18px 0 20px}thead{background:#f3f0e9}th{text-align:left;font-size:10px;letter-spacing:.5px;color:#5f513c;padding:10px 8px}td{padding:11px 8px;border-bottom:1px solid #e8e5df;vertical-align:top}td.num,th.num{text-align:right;white-space:nowrap}.detail{color:#777;font-size:10px;margin-top:3px}.summary{width:52%;margin-left:auto}.summary div{display:flex;justify-content:space-between;padding:6px 0}.summary .total{font-size:16px;font-weight:700;border-top:2px solid #b7a17a;margin-top:5px;padding-top:12px}.notes{margin-top:28px;padding:14px;background:#f7f6f2;white-space:pre-wrap}.notes strong{display:block;font-size:10px;letter-spacing:1px;margin-bottom:5px}.footer{border-top:1px solid #ddd;margin-top:38px;padding-top:12px;color:#888;font-size:9px;display:flex;justify-content:space-between}.print-hint{margin:0 0 16px;padding:10px;background:#f7f6f2;color:#666;font-size:11px}@media print{.print-hint{display:none}}@media screen{body{max-width:800px;margin:24px auto;padding:24px;box-shadow:0 2px 25px #0001}.print-hint{display:block}}
    </style></head><body><div class="print-hint">Per desar el document en PDF, selecciona <b>Desa com a PDF</b> a la finestra d'impressió.</div>
    <header><div><div class="brand">LIGHTCUT STUDIO</div><div class="subbrand">DISSENY · TALL I GRAVAT LÀSER</div></div><div class="doctype"><h1>PRESSUPOST</h1><div><b>${docNo}</b></div><div class="muted">Data: ${issueDate}</div></div></header>
    <section class="details"><div><div class="label">Preparat per a</div><div class="client">${escapeHtml(order.client || "Client")}</div>${order.contact ? `<div>${escapeHtml(order.contact)}</div>` : ""}<div class="event">${escapeHtml(order.eventType || "Encàrrec personalitzat")}</div></div><div><div class="label">Detalls de l'encàrrec</div><div>Data límit d'entrega: <b>${formatDate(order.dueDate)}</b></div><div>Referència: ${escapeHtml(String(order.id || "").slice(0,8).toUpperCase())}</div></div></section>
    <div class="label">Descripció i preus</div><table><thead><tr><th>Producte / servei</th><th class="num">Quant.</th><th class="num">Preu unitari</th><th class="num">Import</th></tr></thead><tbody>${rows || '<tr><td colspan="4">Producte o servei personalitzat</td></tr>'}${extra ? `<tr><td>Altres despeses repercutides</td><td class="num">1</td><td class="num">${moneyPdf(extra)}</td><td class="num">${moneyPdf(extra)}</td></tr>` : ""}</tbody></table>
    <section class="summary"><div><span>Subtotal</span><span>${moneyPdf(subtotal)}</span></div><div><span>IVA (${(vatRate*100).toLocaleString("ca-ES")}%)</span><span>${moneyPdf(vatAmount)}</span></div><div class="total"><span>TOTAL</span><span>${moneyPdf(total)}</span></div></section>
    ${notes ? `<section class="notes"><strong>OBSERVACIONS I CONDICIONS</strong>${escapeHtml(notes)}</section>` : ""}
    <footer class="footer"><span>LightCut Studio · Pressupost orientatiu segons els detalls indicats</span><span>${docNo}</span></footer>
    <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),350));<\/script></body></html>`;
  const popup = window.open("", "_blank");
  if (!popup) { alert("El navegador ha bloquejat la finestra del pressupost. Permet les finestres emergents per a aquest lloc i torna-ho a provar."); return; }
  popup.document.open(); popup.document.write(html); popup.document.close();
}

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
      const quote = document.createElement("button"); quote.className = "small-btn"; quote.textContent = "Pressupost PDF"; quote.addEventListener("click", () => createQuotePdf(o));
      const edit = document.createElement("button"); edit.className = "small-btn"; edit.textContent = "Editar"; edit.addEventListener("click", () => editOrder(o));
      actions.append(quote, edit); right.append(price, actions); card.append(left,right); $("ordersList").append(card);
    });
  }
  $("statCount").textContent = String(orders.length);
  $("statActive").textContent = String(orders.filter(o => ["Confirmada","En producció","Llista per entregar"].includes(o.status)).length);
  $("statTotal").textContent = money(orders.filter(o => o.status !== "Cancel·lada").reduce((s,o)=>s+(Number(o.total)||0),0));
}
$("search").addEventListener("input", renderOrders);
$("statusFilter").addEventListener("change", renderOrders);

onAuthStateChanged(auth, user => {
  $("loginPanel").classList.toggle("hidden", !!user);
  $("appPanel").classList.toggle("hidden", !user);
  $("logoutBtn").classList.toggle("hidden", !user);
  if (unsubscribeOrders) { unsubscribeOrders(); unsubscribeOrders = null; }
  if (unsubscribeCatalog) { unsubscribeCatalog(); unsubscribeCatalog = null; }
  orders = [];
  catalog = [];
  renderOrders();
  renderCatalog();
  if (user) {
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
      renderOrders();
    }, err => {
      console.error(err);
      $("ordersList").innerHTML = `<div class="empty">No es poden carregar les comandes. Revisa les regles de Firestore. (${err.code || "error"})</div>`;
    });
  }
});
addProductRow();