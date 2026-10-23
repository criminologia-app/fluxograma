/* FLUXOGRAMA MONTEIROS — gestão empresarial
   Os registos e as imagens originais ficam guardados neste navegador (IndexedDB). */
(function () {
  "use strict";

  /* ───────────── utilitários ───────────── */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    kids.flat().forEach((c) => { if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return n;
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const num = (n) => (isFinite(parseFloat(n)) ? parseFloat(n) : 0);
  const r2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;
  const grp = (n, d) => { d = d == null ? 2 : d; const neg = num(n) < 0, p = Math.abs(r2(n)).toFixed(d).split("."); return (neg ? "-" : "") + p[0].replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0") + (d ? "," + p[1] : ""); };
  const kz = (n) => grp(n, 2) + "\u00a0Kz";
  const dmy = (s) => (s ? String(s).split("-").reverse().join("/") : "—");
  const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const daysTo = (iso) => Math.round((new Date(iso + "T00:00:00") - new Date(today() + "T00:00:00")) / 864e5);
  const toMin = (t) => { const p = String(t || "").split(":"); return (+p[0] || 0) * 60 + (+p[1] || 0); };
  const low = (s) => String(s == null ? "" : s).trim().toLowerCase();
  const uniq = (arr, k) => Array.from(new Set((arr || []).map((r) => (r[k] || "").trim()).filter(Boolean))).sort();
  function toast(msg, bad) {
    let t = $("#toast");
    if (!t) { t = el("div", { id: "toast", class: "toast", role: "status" }); document.body.append(t); }
    t.textContent = msg; t.className = "toast show" + (bad ? " bad" : "");
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.className = "toast"), 3200);
  }
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sem espaço */ } },
  };

  /* ───────────── base de dados local (IndexedDB) ───────────── */
  let db;
  const R = (rq) => new Promise((ok, ko) => { rq.onsuccess = () => ok(rq.result); rq.onerror = () => ko(rq.error); });
  const st = (n, m) => db.transaction(n, m || "readonly").objectStore(n);
  const DB = {
    open: () => new Promise((ok, ko) => {
      const rq = indexedDB.open("fluxograma_monteiros", 1);
      rq.onupgradeneeded = () => { const d = rq.result; d.createObjectStore("rec", { keyPath: "id" }); d.createObjectStore("img", { keyPath: "id" }); };
      rq.onsuccess = () => { db = rq.result; ok(); };
      rq.onerror = () => ko(rq.error);
    }),
    all: (n) => R(st(n).getAll()),
    get: (n, k) => R(st(n).get(k)),
    put: (n, o) => R(st(n, "readwrite").put(o)),
    del: (n, k) => R(st(n, "readwrite").delete(k)),
    clear: (n) => R(st(n, "readwrite").clear()),
  };

  const DEFAULT_CARGOS = ["Engenheiro", "Técnico", "Eletricista", "Mecânico", "Motorista", "Administrativo", "Gestor"];
  const S = { rec: {}, cargos: [], admin: "" };
  const PANELS = [];

  function nextCode(M) {
    const c = LS.get("fm_cnt", {}); c[M.id] = (c[M.id] || 0) + 1; LS.set("fm_cnt", c);
    return M.pre + "-" + String(c[M.id]).padStart(4, "0");
  }

  /* ───────────── regras de cálculo ───────────── */
  const sumLines = (L) => r2((L || []).reduce((s, l) => s + r2(num(l.qtd) * num(l.preco)), 0));

  function derFat(r) {
    const L = r.linhas || [];
    const subtotal = sumLines(L);
    const desconto = r2(L.reduce((s, l) => s + num(l.desconto), 0));
    const base = r2(subtotal - desconto);
    const taxa = r.iva == null || r.iva === "" ? 14 : num(r.iva);
    const iva = r2((base * taxa) / 100);
    const credito = r.tipo === "Nota de crédito";
    let total = r2(base + iva); if (credito) total = -total;
    const pago = credito ? 0 : r2(r.pago);
    const saldo = credito ? 0 : r2(Math.max(0, total - pago));
    const atraso = !!(r.vencimento && saldo > 0 && r.vencimento < today());
    const estado = credito ? "Crédito" : total > 0 && saldo === 0 ? "Pago" : atraso ? "Em atraso" : pago > 0 ? "Parcial" : "Pendente";
    return { subtotal, desconto, base, taxa, iva, total, pago, saldo, estado, excl: !!r.dup || r.tipo === "Recibo" };
  }
  function derMan(r) {
    const mat = sumLines(r.materiais), mao = r2(r.mao), des = r2(r.desloc), out = r2(r.outros);
    let dur = "—";
    if (r.hini && r.hfim) { let m = toMin(r.hfim) - toMin(r.hini); if (m < 0) m += 1440; dur = Math.floor(m / 60) + "h" + String(m % 60).padStart(2, "0"); }
    return { mat, mao, des, out, total: r2(mat + mao + des + out), dur, excl: !!r.dup };
  }
  const derDesp = (r) => ({ total: r2(num(r.qtd) * num(r.preco)), excl: !!r.dup });
  function derForm(r) {
    const total = r2(num(r.inscricao) + num(r.transporte) + num(r.alojamento) + num(r.alimentacao) + num(r.materiais) + num(r.outros));
    const n = (r.participantes || []).length;
    return { total, n, porPart: n ? r2(total / n) : total, excl: !!r.dup };
  }
  function derSeg(r) {
    const dias = r.fim ? daysTo(r.fim) : null;
    return { dias, estado: dias == null ? "—" : dias < 0 ? "Expirado" : dias <= 30 ? "A expirar" : "Vigente" };
  }
  const nomeFunc = (id) => { const f = (S.rec.funcionarios || []).find((x) => x.id === id); return f ? f.nome : "(removido)"; };

  /* ───────────── definição dos módulos ───────────── */
  const CATS = ["Manutenção", "Telemetria", "Formação", "Combustível", "Material de escritório", "Transporte", "Alimentação", "Renda e serviços", "Outros"];
  const PAGAMENTO = ["Numerário", "Transferência", "Multicaixa / Cartão", "Cheque"];
  const ESTADO_TEL = ["Ativo", "Inativo", "Em manutenção"];
  const tecnicos = () => uniq(S.rec.funcionarios, "nome");
  const DUP = { k: "dup", l: "Não somar ao total geral (já está incluído numa fatura ou noutro registo)", t: "checkbox", w: "full" };
  const OBS = { k: "obs", l: "Observações", t: "textarea", w: "full" };
  const IMGS = (l) => ({ k: "imgs", l: l || "Imagens / PDF (original guardado)", t: "images", w: "full" });
  const BADGE_TEL = { Ativo: "ok", Inativo: "neutral", "Em manutenção": "warn" };

  const MODS = {};
  MODS.faturas = {
    id: "faturas", pre: "FAT", novo: "+ Nova Fatura", nome: "Documento", dateKey: "emissao", derive: derFat,
    fields: [
      { k: "tipo", l: "Tipo de documento", t: "select", opts: ["Fatura", "Fatura-recibo", "Recibo", "Nota de crédito"], def: "Fatura", req: true, hint: "Recibo = comprovativo de pagamento: não soma ao total geral." },
      { k: "numero", l: "Nº do documento", req: true },
      { k: "fornecedor", l: "Fornecedor", req: true, list: () => uniq(S.rec.faturas, "fornecedor") },
      { k: "nif", l: "NIF do fornecedor" },
      { k: "emissao", l: "Data de emissão", t: "date", def: today(), req: true },
      { k: "vencimento", l: "Data de vencimento", t: "date" },
      { k: "categoria", l: "Categoria", t: "select", opts: CATS },
      { k: "iva", l: "IVA (%)", t: "number", def: 14, hint: "14% por defeito; confirme conforme a operação." },
      { k: "linhas", l: "Artigos / serviços", t: "lines", req: true, w: "full",
        cols: [{ k: "descricao", l: "Descrição", t: "text" }, { k: "qtd", l: "Quantidade", t: "number", def: 1 }, { k: "preco", l: "Preço unitário (Kz)", t: "money" }, { k: "desconto", l: "Desconto (Kz)", t: "money" }],
        lineTotal: (l) => r2(num(l.qtd) * num(l.preco) - num(l.desconto)) },
      { k: "pago", l: "Valor pago (Kz)", t: "money" },
      DUP, OBS, IMGS("Imagem(ns) ou PDF da fatura (várias páginas permitidas)"),
    ],
    summary: (v) => { const d = derFat(v); return [["Subtotal", kz(d.subtotal)], ["Desconto", kz(d.desconto)], ["Base tributável", kz(d.base)], ["IVA (" + d.taxa + "%)", kz(d.iva)], ["TOTAL DO DOCUMENTO", kz(d.total), true], ["Valor pago", kz(d.pago)], ["SALDO POR PAGAR", kz(d.saldo), true], ["Estado", d.estado]]; },
    dupMsg: (v, rec) => { const x = (S.rec.faturas || []).find((o) => (!rec || o.id !== rec.id) && low(o.fornecedor) === low(v.fornecedor) && low(o.numero) === low(v.numero)); return x ? "Já existe um documento deste fornecedor com o mesmo número (" + x.cod + "). Guardar mesmo assim?" : ""; },
    cols: [
      { l: "Documento", v: (r) => r.numero }, { l: "Tipo", v: (r) => r.tipo }, { l: "Fornecedor", v: (r) => r.fornecedor }, { l: "NIF", v: (r) => r.nif },
      { l: "Emissão", v: (r) => r.emissao, f: "date" }, { l: "Vencimento", v: (r) => r.vencimento, f: "date" }, { l: "Categoria", v: (r) => r.categoria },
      { l: "Subtotal", v: (r, d) => d.subtotal, f: "money" }, { l: "Desconto", v: (r, d) => d.desconto, f: "money" }, { l: "Base tributável", v: (r, d) => d.base, f: "money" },
      { l: "IVA", v: (r, d) => d.iva, f: "money", sum: true }, { l: "Total", v: (r, d) => d.total, f: "money", sum: true, red: true },
      { l: "Pago", v: (r, d) => d.pago, f: "money", sum: true }, { l: "Saldo", v: (r, d) => d.saldo, f: "money", sum: true, red: true },
      { l: "Estado", v: (r, d) => d.estado, f: "badge", badge: { Pago: "ok", Parcial: "warn", Pendente: "info", "Em atraso": "bad", "Crédito": "neutral" } },
    ],
  };

  const despMod = (id, pre, novo, resp) => ({
    id, pre, novo, nome: "Despesa", dateKey: "data", derive: derDesp,
    fields: [
      { k: "designacao", l: "Designação da despesa", req: true },
      { k: "tecnico", l: "Técnico / responsável", def: resp, list: tecnicos },
      { k: "categoria", l: "Categoria", t: "select", opts: CATS },
      { k: "fornecedor", l: "Fornecedor", list: () => uniq(S.rec.faturas, "fornecedor") },
      { k: "data", l: "Data", t: "date", def: today(), req: true },
      { k: "qtd", l: "Quantidade", t: "number", def: 1, req: true },
      { k: "preco", l: "Preço unitário (Kz)", t: "money", req: true },
      { k: "pagamento", l: "Forma de pagamento", t: "select", opts: PAGAMENTO },
      DUP, OBS, IMGS("Comprovativos (fatura, recibo, fotografia)"),
    ],
    summary: (v) => [["TOTAL DA DESPESA", kz(derDesp(v).total), true]],
    cols: [
      { l: "Data", v: (r) => r.data, f: "date" }, { l: "Designação", v: (r) => r.designacao }, { l: "Técnico / responsável", v: (r) => r.tecnico },
      { l: "Categoria", v: (r) => r.categoria }, { l: "Fornecedor", v: (r) => r.fornecedor }, { l: "Quantidade", v: (r) => num(r.qtd), f: "num" },
      { l: "Preço unitário", v: (r) => num(r.preco), f: "money" }, { l: "Total", v: (r, d) => d.total, f: "money", sum: true, red: true },
    ],
  });
  MODS.desp_geral = despMod("desp_geral", "DSP", "+ Nova Despesa", "");
  MODS.desp_alberto = despMod("desp_alberto", "ALB", "+ Nova Despesa do Eng. Alberto", "Eng. Alberto Monteiro");
  MODS.desp_mateus = despMod("desp_mateus", "MAT", "+ Nova Despesa do Eng. Mateus", "Eng. Mateus");

  MODS.manutencao = {
    id: "manutencao", pre: "MAN", novo: "+ Nova Intervenção", nome: "Intervenção", dateKey: "data", derive: derMan,
    fields: [
      { k: "titulo", l: "Título / avaria", req: true },
      { k: "tecnico", l: "Técnico responsável", req: true, list: tecnicos },
      { k: "local", l: "Local da intervenção", req: true },
      { k: "cliente", l: "Cliente / entidade" },
      { k: "equipamento", l: "Equipamento (matrícula / nº de série)" },
      { k: "data", l: "Data", t: "date", def: today(), req: true },
      { k: "hini", l: "Hora de início", t: "time" },
      { k: "hfim", l: "Hora de conclusão", t: "time" },
      { k: "estado", l: "Estado", t: "select", opts: ["Por iniciar", "Em curso", "Concluída", "Validada", "Suspensa"], def: "Por iniciar" },
      { k: "validadoPor", l: "Validado por" },
      { k: "diagnostico", l: "Diagnóstico", t: "textarea", w: "full" },
      { k: "servico", l: "Trabalho realizado", t: "textarea", w: "full" },
      { k: "materiais", l: "Materiais / peças compradas", t: "lines", w: "full",
        cols: [{ k: "descricao", l: "Material / peça", t: "text" }, { k: "qtd", l: "Quantidade", t: "number", def: 1 }, { k: "preco", l: "Preço unitário (Kz)", t: "money" }],
        lineTotal: (l) => r2(num(l.qtd) * num(l.preco)) },
      { k: "mao", l: "Mão de obra (Kz)", t: "money" }, { k: "desloc", l: "Deslocação (Kz)", t: "money" }, { k: "outros", l: "Outros encargos (Kz)", t: "money" },
      DUP, IMGS("Fotografias, faturas e relatórios da intervenção"),
    ],
    summary: (v) => { const d = derMan(v); return [["Materiais", kz(d.mat)], ["Mão de obra", kz(d.mao)], ["Deslocação", kz(d.des)], ["Outros", kz(d.out)], ["CUSTO TOTAL DA INTERVENÇÃO", kz(d.total), true], ["Duração", d.dur]]; },
    cols: [
      { l: "Data", v: (r) => r.data, f: "date" }, { l: "Título", v: (r) => r.titulo }, { l: "Técnico", v: (r) => r.tecnico }, { l: "Local", v: (r) => r.local },
      { l: "Equipamento", v: (r) => r.equipamento }, { l: "Início", v: (r) => r.hini }, { l: "Fim", v: (r) => r.hfim }, { l: "Duração", v: (r, d) => d.dur },
      { l: "Estado", v: (r) => r.estado, f: "badge", badge: { "Por iniciar": "neutral", "Em curso": "warn", "Concluída": "info", "Validada": "ok", Suspensa: "bad" } },
      { l: "Materiais", v: (r, d) => d.mat, f: "money", sum: true }, { l: "Mão de obra", v: (r, d) => d.mao, f: "money", sum: true },
      { l: "Deslocação", v: (r, d) => d.des, f: "money", sum: true }, { l: "Outros", v: (r, d) => d.out, f: "money", sum: true },
      { l: "Total", v: (r, d) => d.total, f: "money", sum: true, red: true },
    ],
  };

  MODS.funcionarios = {
    id: "funcionarios", pre: "FUN", novo: "+ Novo Funcionário", nome: "Funcionário", dateKey: "entrada",
    fields: [
      { k: "nome", l: "Nome completo", req: true },
      { k: "cargo", l: "Cargo", t: "select", opts: () => S.cargos, req: true, hint: "Gerido na caixa «Cargos» acima." },
      { k: "departamento", l: "Departamento", list: () => uniq(S.rec.funcionarios, "departamento") },
      { k: "contacto", l: "Telefone", t: "tel" },
      { k: "email", l: "E-mail", t: "email" },
      { k: "endereco", l: "Endereço" },
      { k: "entrada", l: "Data de entrada", t: "date" },
      { k: "situacao", l: "Situação", t: "select", opts: ["Ativo", "Férias", "Suspenso", "Inativo"], def: "Ativo" },
      { k: "doc", l: "Nº do BI / documento" },
      OBS, IMGS("Fotografia e documentos do funcionário"),
    ],
    cols: [
      { l: "Nome", v: (r) => r.nome }, { l: "Cargo", v: (r) => r.cargo }, { l: "Departamento", v: (r) => r.departamento }, { l: "Telefone", v: (r) => r.contacto },
      { l: "E-mail", v: (r) => r.email }, { l: "Entrada", v: (r) => r.entrada, f: "date" },
      { l: "Situação", v: (r) => r.situacao, f: "badge", badge: { Ativo: "ok", "Férias": "info", Suspenso: "warn", Inativo: "neutral" } },
    ],
  };

  MODS.formacoes = {
    id: "formacoes", pre: "FOR", novo: "+ Nova Formação", nome: "Formação", dateKey: "inicio", derive: derForm,
    fields: [
      { k: "curso", l: "Nome da formação / curso", req: true },
      { k: "entidade", l: "Entidade formadora" },
      { k: "inicio", l: "Data de início", t: "date", def: today(), req: true },
      { k: "fim", l: "Data de conclusão", t: "date" },
      { k: "participantes", l: "Funcionários participantes", t: "multi", w: "full", req: true, empty: "Ainda não há funcionários. Registe-os primeiro em «Funcionários e Cargos».",
        opts: () => (S.rec.funcionarios || []).map((f) => ({ v: f.id, l: f.nome + (f.cargo ? " — " + f.cargo : "") })) },
      { k: "inscricao", l: "Inscrição (Kz)", t: "money" }, { k: "transporte", l: "Transporte (Kz)", t: "money" }, { k: "alojamento", l: "Alojamento (Kz)", t: "money" },
      { k: "alimentacao", l: "Alimentação (Kz)", t: "money" }, { k: "materiais", l: "Materiais (Kz)", t: "money" }, { k: "outros", l: "Outros custos (Kz)", t: "money" },
      DUP, OBS, IMGS("Faturas, recibos e certificados"),
    ],
    summary: (v) => { const d = derForm(v); return [["CUSTO TOTAL DA FORMAÇÃO", kz(d.total), true], ["Participantes", String(d.n)], ["Custo por participante", kz(d.porPart)]]; },
    check: (v) => (v.inicio && v.fim && v.fim < v.inicio ? "A data de conclusão não pode ser anterior ao início." : ""),
    cols: [
      { l: "Formação", v: (r) => r.curso }, { l: "Entidade", v: (r) => r.entidade }, { l: "Início", v: (r) => r.inicio, f: "date" }, { l: "Fim", v: (r) => r.fim, f: "date" },
      { l: "Participantes", v: (r) => (r.participantes || []).map(nomeFunc).join(", ") },
      { l: "Inscrição", v: (r) => num(r.inscricao), f: "money", sum: true }, { l: "Transporte", v: (r) => num(r.transporte), f: "money", sum: true },
      { l: "Alojamento", v: (r) => num(r.alojamento), f: "money", sum: true }, { l: "Alimentação", v: (r) => num(r.alimentacao), f: "money", sum: true },
      { l: "Materiais", v: (r) => num(r.materiais), f: "money", sum: true }, { l: "Outros", v: (r) => num(r.outros), f: "money", sum: true },
      { l: "Total", v: (r, d) => d.total, f: "money", sum: true, red: true }, { l: "Por participante", v: (r, d) => d.porPart, f: "money" },
    ],
  };

  const telBase = (id, pre, novo, campos, cols) => ({
    id, pre, novo, nome: "Registo", dateKey: "instalacao",
    fields: [...campos, { k: "instalacao", l: "Data de instalação", t: "date" }, { k: "mensalidade", l: "Mensalidade (Kz)", t: "money" },
      { k: "estado", l: "Estado", t: "select", opts: ESTADO_TEL, def: "Ativo" }, OBS, IMGS("Fotografias e documentos do equipamento")],
    cols: [...cols, { l: "Instalação", v: (r) => r.instalacao, f: "date" }, { l: "Estado", v: (r) => r.estado, f: "badge", badge: BADGE_TEL },
      { l: "Mensalidade", v: (r) => num(r.mensalidade), f: "money", sum: true, red: true }],
  });
  MODS.telem_lig = telBase("telem_lig", "LIG", "+ Registar Ligeiro",
    [{ k: "matricula", l: "Matrícula", req: true }, { k: "marca", l: "Marca" }, { k: "modelo", l: "Modelo" }, { k: "cliente", l: "Cliente" }, { k: "dispositivo", l: "Dispositivo de telemetria (nº de série)" }],
    [{ l: "Matrícula", v: (r) => r.matricula }, { l: "Marca", v: (r) => r.marca }, { l: "Modelo", v: (r) => r.modelo }, { l: "Cliente", v: (r) => r.cliente }, { l: "Dispositivo", v: (r) => r.dispositivo }]);
  MODS.telem_ger = telBase("telem_ger", "GER", "+ Registar Gerador",
    [{ k: "ident", l: "Identificação do gerador", req: true }, { k: "marca", l: "Marca" }, { k: "modelo", l: "Modelo" }, { k: "potencia", l: "Potência (kVA)", t: "number" }, { k: "cliente", l: "Cliente" }, { k: "localizacao", l: "Localização" }, { k: "serie", l: "Nº de série / sensor" }],
    [{ l: "Identificação", v: (r) => r.ident }, { l: "Marca", v: (r) => r.marca }, { l: "Modelo", v: (r) => r.modelo }, { l: "kVA", v: (r) => num(r.potencia), f: "num" }, { l: "Cliente", v: (r) => r.cliente }, { l: "Localização", v: (r) => r.localizacao }]);
  MODS.telem_pes = telBase("telem_pes", "PES", "+ Registar Camião",
    [{ k: "matricula", l: "Matrícula", req: true }, { k: "marca", l: "Marca" }, { k: "modelo", l: "Modelo" }, { k: "cliente", l: "Frota / cliente" }, { k: "dispositivo", l: "Dispositivo de telemetria (nº de série)" }, { k: "km", l: "Quilometragem (km)", t: "number" }],
    [{ l: "Matrícula", v: (r) => r.matricula }, { l: "Marca", v: (r) => r.marca }, { l: "Modelo", v: (r) => r.modelo }, { l: "Frota / cliente", v: (r) => r.cliente }, { l: "Dispositivo", v: (r) => r.dispositivo }, { l: "Km", v: (r) => num(r.km), f: "num" }]);
  MODS.telem_seg = {
    id: "telem_seg", pre: "SEG", novo: "+ Registar Apólice", nome: "Apólice", dateKey: "inicio", derive: derSeg,
    fields: [
      { k: "seguradora", l: "Seguradora", req: true }, { k: "apolice", l: "Nº da apólice", req: true }, { k: "ativo", l: "Veículo / equipamento segurado", req: true },
      { k: "cobertura", l: "Cobertura", t: "select", opts: ["Todos os riscos", "Terceiros", "Terceiros ampliado", "Outra"] },
      { k: "premio", l: "Prémio (Kz)", t: "money" }, { k: "inicio", l: "Início da vigência", t: "date", def: today(), req: true }, { k: "fim", l: "Fim da vigência", t: "date", req: true },
      OBS, IMGS("Apólice, recibos e comprovativos"),
    ],
    check: (v) => (v.inicio && v.fim && v.fim < v.inicio ? "O fim da vigência não pode ser anterior ao início." : ""),
    cols: [
      { l: "Seguradora", v: (r) => r.seguradora }, { l: "Apólice", v: (r) => r.apolice }, { l: "Segurado", v: (r) => r.ativo }, { l: "Cobertura", v: (r) => r.cobertura },
      { l: "Início", v: (r) => r.inicio, f: "date" }, { l: "Fim", v: (r) => r.fim, f: "date" }, { l: "Dias", v: (r, d) => (d.dias == null ? "" : d.dias), f: "num" },
      { l: "Estado", v: (r, d) => d.estado, f: "badge", badge: { Vigente: "ok", "A expirar": "warn", Expirado: "bad" } },
      { l: "Prémio", v: (r) => num(r.premio), f: "money", sum: true, red: true },
    ],
  };

  /* ───────────── campos do formulário ───────────── */
  function widget(f, val) {
    const t = f.t || "text", id = "f_" + uid();
    const wide = f.w === "full" || ["lines", "multi", "images", "textarea"].indexOf(t) >= 0;
    const group = el("div", { class: "form-group" + (wide ? " full" : "") });
    const hint = f.hint ? el("span", { class: "hint", text: f.hint }) : null;
    if (t === "lines") return linesWidget(f, val, group);
    if (t === "multi") return multiWidget(f, val, group);
    if (t === "images") return imagesWidget(f, val, group);
    let input, get;
    if (t === "checkbox") {
      input = el("input", { type: "checkbox", id });
      input.checked = !!(val != null ? val : f.def);
      group.append(el("label", { class: "chk-one", for: id }, input, " " + f.l));
      get = () => input.checked;
    } else {
      group.append(el("label", { for: id, text: f.l + (f.req ? " *" : "") }));
      if (t === "select") {
        let opts = typeof f.opts === "function" ? f.opts() : f.opts; opts = opts.slice();
        if (val && opts.indexOf(val) < 0) opts.push(val);
        input = el("select", { id }, el("option", { value: "", text: "— selecionar —" }), opts.map((o) => el("option", { value: o, text: o })));
        input.value = val != null && val !== "" ? val : f.def || "";
      } else if (t === "textarea") {
        input = el("textarea", { id, rows: "3" }); input.value = val != null ? val : "";
      } else {
        const isNum = t === "number" || t === "money";
        input = el("input", { id, type: isNum ? "number" : t, step: isNum ? (t === "money" ? "0.01" : "any") : null, min: isNum ? "0" : null, autocomplete: "off" });
        input.value = val != null && val !== "" ? val : f.def != null ? f.def : "";
        if (f.list) { const dl = el("datalist", { id: id + "_dl" }, f.list().map((x) => el("option", { value: x }))); input.setAttribute("list", id + "_dl"); group.append(dl); }
      }
      group.append(input);
      if (hint) group.append(hint);
      get = t === "number" || t === "money" ? () => (input.value === "" ? 0 : num(input.value)) : () => input.value.trim();
    }
    return { f, node: group, get, focus: () => input.focus() };
  }

  function linesWidget(f, val, group) {
    group.append(el("label", { text: f.l + (f.req ? " *" : "") }));
    const tb = el("tbody"), rows = [], onChange = () => group.dispatchEvent(new Event("input", { bubbles: true }));
    group.append(el("div", { class: "table-wrapper" }, el("table", { class: "excel-table lines-table" },
      el("thead", {}, el("tr", {}, f.cols.map((c) => el("th", { text: c.l })), f.lineTotal ? el("th", { text: "Total da linha" }) : null, el("th", { text: "" }))), tb)));
    function addRow(v) {
      v = v || {}; const tr = el("tr"), ins = {};
      f.cols.forEach((c) => {
        const isT = c.t === "text", inp = el("input", { type: isT ? "text" : "number", step: isT ? null : c.t === "money" ? "0.01" : "any", min: isT ? null : "0", "aria-label": c.l, placeholder: c.l });
        inp.value = v[c.k] != null ? v[c.k] : c.def != null ? c.def : "";
        inp.addEventListener("input", upd); ins[c.k] = { inp, isT }; tr.append(el("td", {}, inp));
      });
      const get = () => { const o = {}; f.cols.forEach((c) => { const x = ins[c.k]; o[c.k] = x.isT ? x.inp.value.trim() : x.inp.value === "" ? 0 : num(x.inp.value); }); return o; };
      const tot = f.lineTotal ? el("td", { class: "line-total" }) : null;
      function upd() { if (tot) tot.textContent = kz(f.lineTotal(get())); }
      if (tot) tr.append(tot);
      tr.append(el("td", {}, el("button", { type: "button", class: "btn-danger", "aria-label": "Remover linha", text: "✕", onclick: () => { tr.remove(); rows.splice(rows.indexOf(rec), 1); onChange(); } })));
      const rec = { get }; rows.push(rec); tb.append(tr); upd();
    }
    (val && val.length ? val : [{}]).forEach(addRow);
    group.append(el("button", { type: "button", class: "btn-secondary", text: "+ Adicionar linha", onclick: () => addRow({}) }));
    const get = () => rows.map((r) => r.get()).filter((r) => f.cols.some((c) => (c.t === "text" ? r[c.k] : num(r[c.k]) > 0 && c.k !== "qtd") || (c.k === "qtd" && f.cols.some((d) => d.k !== "qtd" && (d.t === "text" ? r[d.k] : num(r[d.k]) > 0)))));
    return { f, node: group, get };
  }

  function multiWidget(f, val, group) {
    group.append(el("label", { text: f.l + (f.req ? " *" : "") }));
    const opts = f.opts(), box = el("div", { class: "multi" }), cbs = [];
    if (!opts.length) box.append(el("p", { class: "muted", text: f.empty || "Sem opções." }));
    opts.forEach((o) => { const cb = el("input", { type: "checkbox" }); cb.checked = (val || []).indexOf(o.v) >= 0; cbs.push({ cb, v: o.v }); box.append(el("label", { class: "chk" }, cb, " " + o.l)); });
    group.append(box);
    return { f, node: group, get: () => cbs.filter((c) => c.cb.checked).map((c) => c.v) };
  }

  function imagesWidget(f, val, group) {
    let ids = (val || []).slice(); const pending = [], removed = []; let urls = [];
    group.append(el("label", { text: f.l }));
    const list = el("div", { class: "att-list" });
    const input = el("input", { type: "file", multiple: true, accept: "image/*,application/pdf", "aria-label": f.l });
    group.append(input, list);
    function thumb(blob, name, type, onRm) {
      const u = URL.createObjectURL(blob); urls.push(u);
      const box = el("div", { class: "thumb", title: name, onclick: () => window.open(u, "_blank") });
      if (String(type).indexOf("image/") === 0) box.append(el("img", { src: u, alt: name })); else box.append("PDF");
      box.append(el("button", { type: "button", class: "rm", "aria-label": "Remover " + name, text: "✕", onclick: (e) => { e.stopPropagation(); onRm(); } }));
      return box;
    }
    async function paint() {
      urls.forEach((u) => URL.revokeObjectURL(u)); urls = []; list.replaceChildren();
      for (const id of ids) {
        const im = await DB.get("img", id);
        if (im) list.append(thumb(im.blob, im.name, im.type, () => { ids = ids.filter((x) => x !== id); removed.push(id); paint(); }));
      }
      pending.forEach((p, i) => list.append(thumb(p.file, p.file.name, p.file.type, () => { pending.splice(i, 1); paint(); })));
    }
    input.addEventListener("change", () => { Array.from(input.files).forEach((file) => pending.push({ file })); input.value = ""; paint(); });
    paint();
    return {
      f, node: group, get: () => ids.slice(),
      async commit() {
        for (const p of pending) { const id = uid(); await DB.put("img", { id, name: p.file.name, type: p.file.type, size: p.file.size, blob: p.file }); ids.push(id); }
        pending.length = 0;
        for (const id of removed) await DB.del("img", id);
        removed.length = 0; return ids.slice();
      },
    };
  }

  function buildForm(M, rec, onSave, onCancel) {
    const ws = [], grid = el("div", { class: "form-grid" }), summary = el("div", { class: "summary-box" }), err = el("div", { class: "form-error", role: "alert" });
    const collect = () => { const v = {}; ws.forEach((w) => (v[w.f.k] = w.get())); return v; };
    function paint() {
      if (!M.summary) return;
      summary.replaceChildren(...M.summary(collect()).map((x) => el("div", {}, el("span", { text: x[0] }), el("b", { class: x[2] ? "total-red" : "", text: x[1] }))));
    }
    M.fields.forEach((f) => { const w = widget(f, rec ? rec[f.k] : undefined); ws.push(w); grid.append(w.node); });
    const btn = el("button", { type: "submit", class: "btn-primary", text: rec ? "Guardar alterações" : "Guardar" });
    const form = el("form", { novalidate: true }, grid, M.summary ? summary : null, err,
      el("div", { class: "form-actions" }, btn, el("button", { type: "button", class: "btn-secondary", text: "Cancelar", onclick: onCancel })));
    form.addEventListener("input", paint); form.addEventListener("change", paint); paint();
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); err.textContent = "";
      const v = collect();
      for (const w of ws) {
        const x = v[w.f.k];
        if (w.f.req && (x === "" || x == null || (Array.isArray(x) && !x.length) || (w.f.t === "number" && !x) || (w.f.t === "money" && !x && w.f.k !== "pago"))) { err.textContent = "Preencha: " + w.f.l + "."; if (w.focus) w.focus(); return; }
      }
      const m = M.check ? M.check(v, rec) : ""; if (m) { err.textContent = m; return; }
      const dm = M.dupMsg ? M.dupMsg(v, rec) : ""; if (dm && !confirm(dm)) return;
      btn.disabled = true;
      try { for (const w of ws) if (w.commit) v[w.f.k] = await w.commit(); await onSave(v); }
      catch (x) { err.textContent = "Não foi possível guardar: " + (x && x.message ? x.message : x); }
      finally { btn.disabled = false; }
    });
    return el("div", { class: "form-card" }, el("h3", { text: (rec ? "Editar " : "Novo ") + M.nome.toLowerCase() + (rec ? " — " + rec.cod : "") }), form);
  }

  /* ───────────── galeria de anexos ───────────── */
  async function openGallery(ids, title) {
    const urls = []; let modal;
    const close = () => { urls.forEach((u) => URL.revokeObjectURL(u)); modal.remove(); document.removeEventListener("keydown", esc); };
    const esc = (e) => { if (e.key === "Escape") close(); };
    const big = el("div", { class: "big" }), strip = el("div", { class: "att-list" });
    modal = el("div", { class: "modal", onclick: (e) => { if (e.target === modal) close(); } },
      el("div", { class: "modal-content wide", role: "dialog", "aria-label": title }, el("span", { class: "close-modal", role: "button", "aria-label": "Fechar", text: "×", onclick: close }), el("h3", { text: title }), big, strip));
    document.body.append(modal); document.addEventListener("keydown", esc);
    function show(im, u) {
      big.replaceChildren(String(im.type).indexOf("image/") === 0 ? el("img", { src: u, alt: im.name }) : el("a", { class: "btn-primary", href: u, target: "_blank", rel: "noopener", text: "Abrir PDF: " + im.name }), el("p", { class: "muted", text: im.name }));
    }
    let first = true;
    for (const id of ids) {
      const im = await DB.get("img", id); if (!im) continue;
      const u = URL.createObjectURL(im.blob); urls.push(u);
      const th = el("div", { class: "thumb", title: im.name, onclick: () => show(im, u) });
      if (String(im.type).indexOf("image/") === 0) th.append(el("img", { src: u, alt: im.name })); else th.append("PDF");
      strip.append(th); if (first) { show(im, u); first = false; }
    }
    if (first) big.append(el("p", { class: "muted", text: "Sem anexos." }));
  }

  /* ───────────── painel genérico de um módulo ───────────── */
  const fmtCell = (c, v) => (c.f === "money" ? kz(v) : c.f === "date" ? dmy(v) : c.f === "num" ? (v === "" || v == null ? "—" : grp(v, Number.isInteger(num(v)) ? 0 : 2)) : v == null || v === "" ? "—" : String(v));
  const isNumCol = (c) => c.f === "money" || c.f === "num";

  function csvDownload(name, head, lines) {
    const esc = (v) => { v = String(v == null ? "" : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const txt = "\ufeff" + [head].concat(lines).map((l) => l.map(esc).join(";")).join("\r\n");
    const a = el("a", { href: URL.createObjectURL(new Blob([txt], { type: "text/csv;charset=utf-8" })), download: name + "_" + today() + ".csv" });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  function panel(M, host, extra) {
    const state = { q: "", from: "", to: "", sort: null, dir: 1 };
    const formHost = el("div"), tableHost = el("div", { class: "table-wrapper" }), extraHost = el("div");
    const search = el("input", { type: "search", class: "grow", placeholder: "Pesquisar…", "aria-label": "Pesquisar", oninput: () => { state.q = search.value; draw(); } });
    const from = el("input", { type: "date", "aria-label": "Data inicial", onchange: () => { state.from = from.value; draw(); } });
    const to = el("input", { type: "date", "aria-label": "Data final", onchange: () => { state.to = to.value; draw(); } });
    let shown = [];
    const bar = el("div", { class: "toolbar" },
      el("button", { type: "button", class: "btn-primary", text: M.novo, onclick: () => openForm(null) }), search,
      M.dateKey ? el("label", {}, "De", from) : null, M.dateKey ? el("label", {}, "Até", to) : null,
      el("button", { type: "button", class: "btn-secondary", text: "⬇ Exportar (Excel/CSV)", onclick: () => exportCsv() }),
      el("button", { type: "button", class: "btn-secondary", text: "🖨 Imprimir", onclick: () => window.print() }));
    host.append(bar, formHost, tableHost, extraHost);

    function openForm(rec) {
      const f = buildForm(M, rec, async (v) => { await saveRec(M, rec, v); formHost.replaceChildren(); refreshAll(); }, () => formHost.replaceChildren());
      formHost.replaceChildren(f); f.scrollIntoView({ behavior: "smooth", block: "start" });
      const first = $("input,select,textarea", f); if (first) first.focus();
    }
    function rows() {
      const q = low(state.q);
      let out = (S.rec[M.id] || []).map((r) => ({ r, d: M.derive ? M.derive(r) : {} })).filter(({ r, d }) => {
        const dk = M.dateKey ? r[M.dateKey] || "" : "";
        if (state.from && dk < state.from) return false;
        if (state.to && dk > state.to) return false;
        if (!q) return true;
        return (r.cod + " " + M.cols.map((c) => { const v = c.v(r, d); return v + " " + fmtCell(c, v); }).join(" ")).toLowerCase().indexOf(q) >= 0;
      });
      const si = state.sort;
      out.sort((a, b) => {
        if (si == null) return (b.r[M.dateKey] || "").localeCompare(a.r[M.dateKey] || "") || b.r.created - a.r.created;
        const x = M.cols[si].v(a.r, a.d), y = M.cols[si].v(b.r, b.d);
        return (isNumCol(M.cols[si]) ? num(x) - num(y) : String(x == null ? "" : x).localeCompare(String(y == null ? "" : y), "pt", { numeric: true })) * state.dir;
      });
      return out;
    }
    function draw() {
      shown = rows();
      const head = el("tr", {}, el("th", { class: "rownum", text: "#" }), el("th", { text: "Cód." }),
        M.cols.map((c, i) => el("th", { class: isNumCol(c) ? "num" : "", title: "Ordenar", onclick: () => { if (state.sort === i) state.dir = -state.dir; else { state.sort = i; state.dir = 1; } draw(); }, text: c.l + (state.sort === i ? (state.dir > 0 ? " ▲" : " ▼") : "") })),
        el("th", { text: "Anexos" }), el("th", { class: "row-actions", text: "Ações" }));
      const body = el("tbody");
      if (!shown.length) body.append(el("tr", { class: "empty-row" }, el("td", { colspan: M.cols.length + 4, text: (S.rec[M.id] || []).length ? "Nenhum registo corresponde à pesquisa." : "Ainda não há registos. Use o botão «" + M.novo + "»." })));
      shown.forEach(({ r, d }, i) => {
        const n = (r.imgs || []).length;
        body.append(el("tr", {}, el("td", { class: "rownum", text: String(i + 1) }), el("td", { text: r.cod }),
          M.cols.map((c) => {
            const v = c.v(r, d); let cell;
            if (c.f === "badge") cell = el("span", { class: "badge " + ((c.badge && c.badge[v]) || "neutral"), text: v || "—" }); else cell = fmtCell(c, v);
            return el("td", { class: (isNumCol(c) ? "num " : "") + (c.red ? "total-red" : "") }, cell);
          }),
          el("td", {}, n ? el("button", { type: "button", class: "btn-secondary", text: "📎 " + n, "aria-label": "Ver " + n + " anexos", onclick: () => openGallery(r.imgs, M.nome + " " + r.cod) }) : "—"),
          el("td", { class: "row-actions" },
            el("button", { type: "button", title: "Editar", "aria-label": "Editar " + r.cod, text: "✏️", onclick: () => openForm(r) }),
            el("button", { type: "button", title: "Eliminar", "aria-label": "Eliminar " + r.cod, text: "🗑️", onclick: () => removeRec(M, r) }))));
      });
      const sums = M.cols.some((c) => c.sum), foot = el("tfoot");
      if (sums && shown.length) {
        let excl = 0; const tot = M.cols.map(() => 0);
        shown.forEach(({ r, d }) => { if (d.excl) { excl++; return; } M.cols.forEach((c, i) => { if (c.sum) tot[i] = r2(tot[i] + num(c.v(r, d))); }); });
        foot.append(el("tr", { class: "table-total-row" }, el("td", { colspan: 2, text: "TOTAL" + (excl ? " (sem " + excl + " marcado(s))" : "") }),
          M.cols.map((c, i) => el("td", { class: "num " + (c.sum ? "total-red" : ""), text: c.sum ? kz(tot[i]) : "" })), el("td"), el("td")));
      }
      tableHost.replaceChildren(el("table", { class: "excel-table" }, el("thead", {}, head), body, foot));
      extraHost.replaceChildren(); if (extra) { const x = extra(); if (x) extraHost.append(x); }
    }
    function exportCsv() {
      const lines = shown.map(({ r, d }) => [r.cod].concat(M.cols.map((c) => { const v = c.v(r, d); return isNumCol(c) ? String(r2(v)).replace(".", ",") : c.f === "date" ? (v ? dmy(v) : "") : v == null ? "" : v; })));
      csvDownload("FluxogramaMonteiros_" + M.id, ["Cód."].concat(M.cols.map((c) => c.l)), lines);
    }
    PANELS.push({ draw }); draw();
  }

  async function saveRec(M, rec, v) {
    const o = Object.assign({}, rec || {}, v, { id: rec ? rec.id : uid(), mod: M.id, created: rec ? rec.created : Date.now(), updated: Date.now() });
    if (!rec) o.cod = nextCode(M);
    await DB.put("rec", o);
    const arr = S.rec[M.id] || (S.rec[M.id] = []), i = arr.findIndex((x) => x.id === o.id);
    if (i >= 0) arr[i] = o; else arr.push(o);
    toast(rec ? "Registo atualizado." : "Registo guardado: " + o.cod);
  }
  async function removeRec(M, r) {
    if (!confirm("Eliminar o registo " + r.cod + "? Os anexos associados também serão apagados.")) return;
    for (const id of r.imgs || []) await DB.del("img", id);
    await DB.del("rec", r.id);
    S.rec[M.id] = (S.rec[M.id] || []).filter((x) => x.id !== r.id);
    toast("Registo eliminado."); refreshAll();
  }
  function refreshAll() { PANELS.forEach((p) => p.draw()); renderDash(); }

  /* ───────────── cargos ───────────── */
  function cargosCard(host) {
    const input = el("input", { type: "text", class: "grow", placeholder: "Novo cargo (ex.: Chefe de Oficina)", maxlength: "40", "aria-label": "Novo cargo" });
    const chips = el("div", { class: "chips" });
    function draw() {
      chips.replaceChildren(...S.cargos.map((c) => el("span", { class: "chip" }, c, el("button", { type: "button", "aria-label": "Remover cargo " + c, text: "✕", onclick: () => {
        const usados = (S.rec.funcionarios || []).filter((f) => f.cargo === c).length;
        if (usados && !confirm(usados + " funcionário(s) têm o cargo «" + c + "». Remover o cargo da lista?")) return;
        S.cargos = S.cargos.filter((x) => x !== c); LS.set("fm_cargos", S.cargos); draw();
      } }))));
      if (!S.cargos.length) chips.append(el("span", { class: "muted", text: "Sem cargos. Adicione o primeiro." }));
    }
    function add() {
      const v = input.value.trim(); if (!v) return;
      if (S.cargos.some((c) => low(c) === low(v))) { toast("Esse cargo já existe.", true); return; }
      S.cargos.push(v); S.cargos.sort((a, b) => a.localeCompare(b, "pt")); LS.set("fm_cargos", S.cargos); input.value = ""; draw(); toast("Cargo adicionado.");
    }
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
    host.append(el("div", { class: "form-card" }, el("h3", { text: "Cargos" }), el("p", { class: "muted", text: "Crie aqui as funções da empresa; depois escolha-as na ficha de cada funcionário." }),
      el("div", { class: "toolbar" }, input, el("button", { type: "button", class: "btn-primary", text: "+ Adicionar cargo", onclick: add })), chips));
    draw();
  }

  /* ───────────── telemetria (4 separadores) ───────────── */
  function telemetria(host) {
    const tabs = el("div", { class: "tabs-container", role: "tablist" }), body = el("div"), btns = [], panes = [];
    [["telem_lig", "Ligeiros"], ["telem_ger", "Grupos Geradores"], ["telem_pes", "Camiões Pesados"], ["telem_seg", "Seguros"]].forEach(([id, label], i) => {
      const pane = el("div", { class: "tab-content" + (i ? "" : " active") }), btn = el("button", { type: "button", role: "tab", class: "tab-btn" + (i ? "" : " active"), text: label });
      btn.addEventListener("click", () => { btns.forEach((b, j) => { b.classList.toggle("active", j === i); panes[j].classList.toggle("active", j === i); }); });
      btns.push(btn); panes.push(pane); tabs.append(btn); body.append(pane); panel(MODS[id], pane);
    });
    host.append(tabs, body);
  }

  /* ───────────── custo por funcionário (formações) ───────────── */
  function custoPorFuncionario() {
    const map = {};
    (S.rec.formacoes || []).forEach((r) => { const d = derForm(r); if (d.excl) return; (r.participantes || []).forEach((id) => { const m = map[id] || (map[id] = { n: 0, t: 0 }); m.n++; m.t = r2(m.t + d.porPart); }); });
    const ids = Object.keys(map); if (!ids.length) return null;
    ids.sort((a, b) => nomeFunc(a).localeCompare(nomeFunc(b), "pt"));
    const tot = r2(ids.reduce((s, id) => s + map[id].t, 0));
    return el("div", {}, el("h3", { class: "section-title", text: "Custo de formação por funcionário" }), el("div", { class: "table-wrapper" }, el("table", { class: "excel-table" },
      el("thead", {}, el("tr", {}, el("th", { text: "Funcionário" }), el("th", { class: "num", text: "Formações" }), el("th", { class: "num", text: "Custo total" }))),
      el("tbody", {}, ids.map((id) => el("tr", {}, el("td", { text: nomeFunc(id) }), el("td", { class: "num", text: String(map[id].n) }), el("td", { class: "num total-red", text: kz(map[id].t) })))),
      el("tfoot", {}, el("tr", { class: "table-total-row" }, el("td", { text: "TOTAL" }), el("td"), el("td", { class: "num total-red", text: kz(tot) }))))));
  }

  /* ───────────── painel principal ───────────── */
  function totals() {
    const A = (id) => S.rec[id] || [];
    const sum = (id, der, key) => r2(A(id).map((r) => der(r)).filter((d) => !d.excl).reduce((s, d) => s + d[key], 0));
    const T = {
      fat: sum("faturas", derFat, "total"), saldo: sum("faturas", derFat, "saldo"),
      dg: sum("desp_geral", derDesp, "total"), da: sum("desp_alberto", derDesp, "total"), dm: sum("desp_mateus", derDesp, "total"),
      man: sum("manutencao", derMan, "total"), form: sum("formacoes", derForm, "total"),
    };
    T.geral = r2(T.fat + T.dg + T.da + T.dm + T.man + T.form);
    T.mensal = r2(["telem_lig", "telem_ger", "telem_pes"].reduce((s, id) => s + A(id).reduce((a, r) => a + num(r.mensalidade), 0), 0));
    T.premios = r2(A("telem_seg").reduce((s, r) => s + num(r.premio), 0));
    T.equip = A("telem_lig").length + A("telem_ger").length + A("telem_pes").length;
    return T;
  }
  function renderDash() {
    const host = $("#dash"); if (!host) return;
    const T = totals(), A = (id) => S.rec[id] || [];
    const card = (l, v, o) => el("div", { class: "card" + (o && o.alert ? " card-alert" : "") + (o && o.total ? " card-total" : "") }, el("h3", { text: l }), el("div", { class: "card-value" + (o && o.red ? " total-red" : ""), text: v }));
    const alerts = [];
    A("faturas").forEach((r) => { const d = derFat(r); if (d.estado === "Em atraso") alerts.push("Fatura " + r.numero + " (" + r.fornecedor + ") em atraso desde " + dmy(r.vencimento) + " — saldo " + kz(d.saldo)); });
    A("telem_seg").forEach((r) => { const d = derSeg(r); if (d.estado === "Expirado") alerts.push("Seguro " + r.apolice + " (" + r.ativo + ") expirou em " + dmy(r.fim)); else if (d.estado === "A expirar") alerts.push("Seguro " + r.apolice + " (" + r.ativo + ") expira em " + d.dias + " dia(s)"); });
    A("manutencao").forEach((r) => { if (r.estado === "Em curso") alerts.push("Manutenção em curso: " + r.titulo + " — " + (r.tecnico || "sem técnico")); });
    const months = {}, add = (k, v, ex) => { if (!k || ex) return; const m = String(k).slice(0, 7); months[m] = r2((months[m] || 0) + v); };
    A("faturas").forEach((r) => { const d = derFat(r); add(r.emissao, d.total, d.excl); });
    ["desp_geral", "desp_alberto", "desp_mateus"].forEach((id) => A(id).forEach((r) => { const d = derDesp(r); add(r.data, d.total, d.excl); }));
    A("manutencao").forEach((r) => { const d = derMan(r); add(r.data, d.total, d.excl); });
    A("formacoes").forEach((r) => { const d = derForm(r); add(r.inicio, d.total, d.excl); });
    const ms = Object.keys(months).sort().reverse().slice(0, 12);
    host.replaceChildren(
      el("h1", { text: "Painel Principal" }), el("p", { class: "subtitle", text: "Resumo geral das finanças, documentos e custos operacionais." }),
      el("div", { class: "cards-grid mini" },
        card("Total de faturas", kz(T.fat)), card("Saldo por pagar (faturas)", kz(T.saldo), { red: true }), card("Despesas gerais", kz(T.dg)),
        card("Eng. Alberto Monteiro", kz(T.da)), card("Eng. Mateus", kz(T.dm)), card("Manutenção", kz(T.man)), card("Formações", kz(T.form)),
        card("TOTAL GERAL DE CUSTOS REGISTADOS", kz(T.geral), { red: true, total: true })),
      el("p", { class: "muted", text: "Total geral = faturas + despesas gerais + engenheiros + manutenção + formações (sem os registos marcados «não somar» e sem recibos). A telemetria aparece à parte." }),
      el("div", { class: "cards-grid mini" },
        card("Funcionários", String(A("funcionarios").length)), card("Equipamentos em telemetria", String(T.equip)),
        card("Mensalidades de telemetria", kz(T.mensal), { red: true }), card("Prémios de seguros", kz(T.premios), { red: true })),
      el("h3", { class: "section-title", text: "Alertas" }),
      alerts.length ? el("ul", { class: "alert-list" }, alerts.map((a) => el("li", { text: a }))) : el("p", { class: "muted", text: "Sem alertas neste momento." }),
      el("h3", { class: "section-title", text: "Custos por mês (últimos 12 meses com movimento)" }),
      ms.length ? el("div", { class: "table-wrapper" }, el("table", { class: "excel-table" }, el("thead", {}, el("tr", {}, el("th", { text: "Mês" }), el("th", { class: "num", text: "Custos registados" }))),
        el("tbody", {}, ms.map((m) => el("tr", {}, el("td", { text: m.split("-").reverse().join("/") }), el("td", { class: "num total-red", text: kz(months[m]) })))),
        el("tfoot", {}, el("tr", { class: "table-total-row" }, el("td", { text: "TOTAL" }), el("td", { class: "num total-red", text: kz(ms.reduce((s, m) => s + months[m], 0)) }))))) : el("p", { class: "muted", text: "Ainda não há custos com data registados." }));
  }

  /* ───────────── cópia de segurança ───────────── */
  const blobToDataURL = (b) => new Promise((ok, ko) => { const f = new FileReader(); f.onload = () => ok(f.result); f.onerror = () => ko(f.error); f.readAsDataURL(b); });
  async function exportBackup() {
    const recs = await DB.all("rec"), imgs = await DB.all("img");
    const out = []; for (const im of imgs) out.push({ id: im.id, name: im.name, type: im.type, data: await blobToDataURL(im.blob) });
    const payload = { app: "fluxograma-monteiros", versao: 1, data: new Date().toISOString(), admin: S.admin, cargos: S.cargos, contadores: LS.get("fm_cnt", {}), registos: recs, imagens: out };
    const a = el("a", { href: URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: "application/json" })), download: "fluxograma-monteiros-copia-" + today() + ".json" });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    toast("Cópia de segurança descarregada (" + recs.length + " registos, " + out.length + " imagens).");
  }
  async function importBackup(file) {
    let j; try { j = JSON.parse(await file.text()); } catch (e) { toast("Ficheiro inválido.", true); return; }
    if (!j || j.app !== "fluxograma-monteiros" || !Array.isArray(j.registos)) { toast("Este ficheiro não é uma cópia do FLUXOGRAMA MONTEIROS.", true); return; }
    if (!confirm("Substituir TODOS os dados atuais pelos da cópia (" + j.registos.length + " registos, " + (j.imagens || []).length + " imagens)?")) return;
    await DB.clear("rec"); await DB.clear("img");
    for (const r of j.registos) await DB.put("rec", r);
    for (const im of j.imagens || []) { const blob = await (await fetch(im.data)).blob(); await DB.put("img", { id: im.id, name: im.name, type: im.type, size: blob.size, blob }); }
    LS.set("fm_cargos", j.cargos || DEFAULT_CARGOS); LS.set("fm_cnt", j.contadores || {}); if (j.admin) LS.set("fm_admin", j.admin);
    toast("Cópia restaurada. A recarregar…"); setTimeout(() => location.reload(), 900);
  }
  function backupSection(host) {
    const info = el("p", { class: "muted" }), file = el("input", { type: "file", accept: "application/json,.json", "aria-label": "Ficheiro da cópia de segurança" });
    file.addEventListener("change", () => { if (file.files[0]) importBackup(file.files[0]); file.value = ""; });
    async function stats() {
      const n = (await DB.all("rec")).length, im = (await DB.all("img")).length; let uso = "";
      try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); uso = " Espaço usado: " + (e.usage / 1048576).toFixed(1) + " MB."; } } catch (e) { /* sem estimativa */ }
      info.textContent = n + " registos e " + im + " imagens/PDF guardados neste navegador." + uso;
    }
    host.append(el("h1", { text: "Cópia de Segurança" }),
      el("p", { class: "subtitle", text: "Os dados ficam guardados neste navegador, neste computador. Faça cópias com regularidade." }),
      el("div", { class: "form-card" }, info,
        el("div", { class: "form-actions" }, el("button", { type: "button", class: "btn-primary", text: "⬇ Descarregar cópia de segurança", onclick: exportBackup })),
        el("h3", { class: "section-title", text: "Restaurar uma cópia" }), el("p", { class: "muted", text: "Substitui todos os dados atuais pelos do ficheiro escolhido." }), file,
        el("h3", { class: "section-title", text: "Apagar tudo" }),
        el("button", { type: "button", class: "btn-danger", text: "Apagar todos os dados deste navegador", onclick: async () => {
          if (!confirm("Isto apaga TODOS os registos e imagens deste navegador. Fez uma cópia de segurança?")) return;
          if (!confirm("Tem a certeza absoluta? Não é possível desfazer.")) return;
          await DB.clear("rec"); await DB.clear("img"); localStorage.removeItem("fm_cnt"); location.reload();
        } })));
    stats(); PANELS.push({ draw: stats });
  }

  /* ───────────── navegação e arranque ───────────── */
  function go(id) {
    $$(".content-section").forEach((s) => s.classList.toggle("active", s.id === id));
    $$(".menu-btn").forEach((b) => b.classList.toggle("active", b.dataset.target === id));
    try { sessionStorage.setItem("fm_sec", id); } catch (e) { /* ignorar */ }
    const m = $(".main-content"); if (m) m.scrollTop = 0; window.scrollTo(0, 0);
  }
  function perfil() {
    const nome = $("#admin-name"); nome.textContent = S.admin;
    $("#btn-alterar-admin").addEventListener("click", () => {
      const v = prompt("Nome da administradora:", S.admin);
      if (v && v.trim()) { S.admin = v.trim().slice(0, 60); LS.set("fm_admin", S.admin); nome.textContent = S.admin; }
    });
  }
  async function init() {
    try { await DB.open(); } catch (e) {
      document.body.prepend(el("div", { class: "fatal", text: "Este navegador não permite guardar dados (IndexedDB indisponível). Não use o modo privado e abra a aplicação num navegador atual (Chrome, Edge ou Firefox)." })); return;
    }
    (await DB.all("rec")).forEach((r) => { (S.rec[r.mod] || (S.rec[r.mod] = [])).push(r); });
    S.cargos = LS.get("fm_cargos", DEFAULT_CARGOS.slice()); S.admin = LS.get("fm_admin", "Eng.ª Administradora");
    perfil();
    panel(MODS.faturas, $("#p-faturas"));
    telemetria($("#p-telemetria"));
    panel(MODS.manutencao, $("#p-manutencao"));
    panel(MODS.desp_geral, $("#p-despesas"));
    panel(MODS.desp_alberto, $("#p-alberto"));
    panel(MODS.desp_mateus, $("#p-mateus"));
    cargosCard($("#p-cargos"));
    panel(MODS.funcionarios, $("#p-funcionarios"));
    panel(MODS.formacoes, $("#p-formacoes"), custoPorFuncionario);
    backupSection($("#p-backup"));
    $$(".menu-btn").forEach((b) => b.addEventListener("click", () => go(b.dataset.target)));
    renderDash();
    let last = "sec-dashboard"; try { last = sessionStorage.getItem("fm_sec") || last; } catch (e) { /* ignorar */ }
    go($("#" + last) ? last : "sec-dashboard");
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();







/* ==========================================================================
   MÓDULO DE GERAÇÃO E IMPRESSÃO DE FATURAS PROFORMA (MONTEIROS & ML VUBO)
   ========================================================================== */
(function initProformaModule() {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const num = (n) => (isFinite(parseFloat(n)) ? parseFloat(n) : 0);
  const r2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;
  const grp = (n) => {
    const p = Math.abs(r2(n)).toFixed(2).split(".");
    return (num(n) < 0 ? "-" : "") + p[0].replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0") + "," + p[1];
  };
  const kz = (n) => grp(n) + "\u00a0Kz";
  const dmy = (iso) => (iso ? String(iso).split("-").reverse().join("/") : "—");

  // Dados iniciais de itens
  let proformaItens = [
    { cod: "00486", desc: "Manutenção Preventiva / Corretiva de Sistema HVAC", qtd: 1, preco: 150000, descPct: 0, ivaPct: 14 },
    { cod: "00250", desc: "Material de Reposição e Consumíveis", qtd: 2, preco: 35000, descPct: 0, ivaPct: 14 }
  ];

  function renderLinhasForm() {
    const tbody = $("#pf-tbody-itens");
    if (!tbody) return;
    tbody.innerHTML = "";

    proformaItens.forEach((item, index) => {
      const tr = document.createElement("tr");
      
      const sub = item.qtd * item.preco;
      const descVal = (sub * item.descPct) / 100;
      const base = sub - descVal;
      const ivaVal = (base * item.ivaPct) / 100;
      const totalItem = base + ivaVal;

      tr.innerHTML = `
        <td><input type="text" class="pf-item-cod" value="${item.cod}" style="width:100%; padding:6px; border:1px solid #cbd5e1; border-radius:4px;"></td>
        <td><input type="text" class="pf-item-desc" value="${item.desc}" style="width:100%; padding:6px; border:1px solid #cbd5e1; border-radius:4px;"></td>
        <td><input type="number" class="pf-item-qtd" value="${item.qtd}" min="1" style="width:100%; padding:6px; border:1px solid #cbd5e1; border-radius:4px;"></td>
        <td><input type="number" class="pf-item-preco" value="${item.preco}" step="0.01" style="width:100%; padding:6px; border:1px solid #cbd5e1; border-radius:4px;"></td>
        <td><input type="number" class="pf-item-descpct" value="${item.descPct}" min="0" max="100" style="width:100%; padding:6px; border:1px solid #cbd5e1; border-radius:4px;"></td>
        <td><input type="number" class="pf-item-ivapct" value="${item.ivaPct}" min="0" max="100" style="width:100%; padding:6px; border:1px solid #cbd5e1; border-radius:4px;"></td>
        <td style="font-weight:700; text-align:right; padding-top:10px;">${kz(totalItem)}</td>
        <td style="text-align:center;"><button type="button" class="pf-btn-del" style="background:none; border:none; color:#dc2626; cursor:pointer; font-weight:700;">✕</button></td>
      `;

      // Eventos de alteração dos campos da linha
      const inputs = tr.querySelectorAll("input");
      inputs.forEach(inp => inp.addEventListener("input", () => atualizarLinhaObj(index, tr)));

      tr.querySelector(".pf-btn-del").addEventListener("click", () => {
        proformaItens.splice(index, 1);
        renderLinhasForm();
        atualizarDocumentoProforma();
      });

      tbody.appendChild(tr);
    });
  }

  function atualizarLinhaObj(index, tr) {
    proformaItens[index] = {
      cod: tr.querySelector(".pf-item-cod").value,
      desc: tr.querySelector(".pf-item-desc").value,
      qtd: num(tr.querySelector(".pf-item-qtd").value),
      preco: num(tr.querySelector(".pf-item-preco").value),
      descPct: num(tr.querySelector(".pf-item-descpct").value),
      ivaPct: num(tr.querySelector(".pf-item-ivapct").value)
    };
    atualizarDocumentoProforma();
  }

  function atualizarDocumentoProforma() {
    // 1. Alternar Logótipos e Cabeçalho da Empresa Emissora
    const emissora = $("#pf-empresa-emissora").value;
    const imgMonteiros = $("#pf-img-monteiros");
    const imgMlvubo = $("#pf-img-mlvubo");
    const viewNome = $("#pf-view-empresa-nome");
    const viewDesc = $("#pf-view-empresa-desc");

    if (emissora === "MONTEIROS") {
      if (imgMonteiros) imgMonteiros.style.display = "block";
      if (imgMlvubo) imgMlvubo.style.display = "none";
      if (viewNome) viewNome.textContent = "MONTEIROS & MONTEIROS, LDA";
      if (viewDesc) viewDesc.textContent = "Prestação de Serviços, Frio Industrial e Climatização";
    } else if (emissora === "MLVUBO") {
      if (imgMonteiros) imgMonteiros.style.display = "none";
      if (imgMlvubo) imgMlvubo.style.display = "block";
      if (viewNome) viewNome.textContent = "ML VUBO — COMÉRCIO GERAL E SERVIÇOS, LDA";
      if (viewDesc) viewDesc.textContent = "Comércio Geral, Manutenção e Prestação de Serviços";
    } else {
      if (imgMonteiros) imgMonteiros.style.display = "block";
      if (imgMlvubo) imgMlvubo.style.display = "block";
      if (viewNome) viewNome.textContent = "MONTEIROS & MONTEIROS / ML VUBO";
      if (viewDesc) viewDesc.textContent = "Consórcio Empresarial & Prestação de Serviços Técnicos";
    }

    // 2. Dados Gerais do Documento e Cliente
    const docNum = $("#pf-doc-num").value || "PP 2026/001";
    const docData = $("#pf-doc-data").value ? dmy($("#pf-doc-data").value) : dmy(new Date().toISOString().slice(0, 10));
    const docValidade = $("#pf-doc-validade").value || "15";

    $("#pf-out-num").textContent = docNum;
    $("#pf-out-data").textContent = docData;
    $("#pf-out-validade").textContent = docValidade + " Dias";
    $("#pf-out-dias-val").textContent = docValidade;

    $("#pf-out-cli-nome").textContent = ($("#pf-cli-nome").value || "CONSUMIDOR FINAL").toUpperCase();
    $("#pf-out-cli-nif").textContent = ($("#pf-cli-nif").value || "CONSUMIDOR FINAL").toUpperCase();
    $("#pf-out-cli-endereco").textContent = $("#pf-cli-endereco").value || "Luanda, Angola";
    $("#pf-out-vendedor").textContent = $("#pf-vendedor").value || "Administradora";

    // 3. Tabela de Impressão e Totais
    const outTbody = $("#pf-out-tbody");
    outTbody.innerHTML = "";

    let totalSub = 0;
    let totalDesc = 0;
    let totalIva = 0;

    proformaItens.forEach(item => {
      const sub = item.qtd * item.preco;
      const descVal = (sub * item.descPct) / 100;
      const base = sub - descVal;
      const ivaVal = (base * item.ivaPct) / 100;
      const totalItem = base + ivaVal;

      totalSub += sub;
      totalDesc += descVal;
      totalIva += ivaVal;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${item.cod || "—"}</td>
        <td><strong>${item.desc || "Item sem descrição"}</strong></td>
        <td style="text-align:center;">${item.qtd}</td>
        <td style="text-align:right;">${grp(item.preco)}</td>
        <td style="text-align:right;">${item.descPct > 0 ? item.descPct + "%" : "—"}</td>
        <td style="text-align:right;">${item.ivaPct}%</td>
        <td style="text-align:right; font-weight:700;">${grp(totalItem)}</td>
      `;
      outTbody.appendChild(tr);
    });

    // Retenção na fonte
    const baseTributavel = totalSub - totalDesc;
    const taxaRetencao = num($("#pf-retencao-taxa").value);
    const valRetencao = (baseTributavel * taxaRetencao) / 100;
    const totalGeral = baseTributavel + totalIva - valRetencao;

    $("#pf-out-subtotal").textContent = kz(totalSub);
    $("#pf-out-desconto").textContent = kz(totalDesc);
    $("#pf-out-iva").textContent = kz(totalIva);
    $("#pf-out-retencao").textContent = kz(valRetencao);
    $("#pf-out-total-geral").textContent = kz(totalGeral);

    const rowRet = $("#pf-row-retencao");
    if (rowRet) rowRet.style.display = taxaRetencao > 0 ? "flex" : "none";
  }

  function bindEvents() {
    // Botão Adicionar Item
    const btnAdd = $("#pf-btn-add-linha");
    if (btnAdd) {
      btnAdd.addEventListener("click", () => {
        proformaItens.push({ cod: "000", desc: "Novo Serviço / Equipamento", qtd: 1, preco: 0, descPct: 0, ivaPct: 14 });
        renderLinhasForm();
        atualizarDocumentoProforma();
      });
    }

    // Escuta mudanças nos selects e inputs fixos
    ["pf-empresa-emissora", "pf-doc-num", "pf-doc-data", "pf-doc-validade", "pf-cli-nome", "pf-cli-nif", "pf-cli-endereco", "pf-retencao-taxa", "pf-vendedor"].forEach(id => {
      const el = $("#" + id);
      if (el) el.addEventListener("change", atualizarDocumentoProforma);
      if (el && el.tagName === "INPUT") el.addEventListener("keyup", atualizarDocumentoProforma);
    });

    // Botão de Atualizar e Visualizar
    const btnGerar = $("#pf-btn-gerar");
    if (btnGerar) {
      btnGerar.addEventListener("click", () => {
        atualizarDocumentoProforma();
        const doc = $("#pf-print-document");
        if (doc) doc.scrollIntoView({ behavior: "smooth" });
      });
    }

    // Botão de Impressão Nativa / Salvar PDF
    const btnImprimir = $("#pf-btn-imprimir");
    if (btnImprimir) {
      btnImprimir.addEventListener("click", () => {
        atualizarDocumentoProforma();
        window.print();
      });
    }

    // Definir data de hoje por defeito no input
    const inData = $("#pf-doc-data");
    if (inData && !inData.value) {
      inData.value = new Date().toISOString().slice(0, 10);
    }
  }

  // Inicialização do Módulo
  document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    renderLinhasForm();
    atualizarDocumentoProforma();
  });
})();
