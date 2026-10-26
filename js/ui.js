// Ventanas de ayuda (bienvenida y manual) y formulario de contacto.
const $ = id => document.getElementById(id);
const KEY = 'ocultar-matriculas.sin-bienvenida';
const store = {
  get() { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } },
  set(v) { try { v ? localStorage.setItem(KEY, '1') : localStorage.removeItem(KEY); } catch { /* sin almacenamiento */ } },
};

for (const d of document.querySelectorAll('dialog')) {
  d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
}
const open = d => { if (!d.open) d.showModal(); };

// Bienvenida: solo si el usuario no marcó «No mostrar de nuevo». La casilla se guarda en cuanto se pulsa.
$('noMore').checked = store.get();
$('noMore').addEventListener('change', e => store.set(e.target.checked));
if (!store.get()) open($('dlgWelcome'));

$('btnHelp').onclick = () => open($('dlgHelp'));
document.querySelector('[data-manual]').onclick = () => { $('dlgWelcome').close(); open($('dlgHelp')); };
$('showWelcomeAgain').onclick = e => { e.preventDefault(); store.set(false); $('noMore').checked = false; e.target.textContent = 'Listo: la ayuda de inicio volverá a mostrarse.'; };

// Contacto
const msg = (t, cls = '') => { const m = $('cmsg'); m.textContent = t; m.className = cls; };
$('btnContact').onclick = () => { msg(''); open($('dlgContact')); $('cName').focus(); };
$('fContact').addEventListener('submit', async e => {
  e.preventDefault();
  const body = { name: $('cName').value.trim(), email: $('cEmail').value.trim(), message: $('cText').value.trim(), consent: $('cConsent').checked, website: $('cWeb').value };
  if (!body.name) return msg('Escribe tu nombre.', 'err');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(body.email)) return msg('Escribe un correo válido.', 'err');
  if (body.message.length < 10) return msg('El mensaje es demasiado corto.', 'err');
  if (!body.consent) return msg('Debes aceptar el uso de tus datos para poder responderte.', 'err');
  $('cSend').disabled = true; msg('Enviando…');
  try {
    const r = await fetch('api/contacto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Error ' + r.status);
    msg('¡Mensaje enviado! Gracias.', 'ok');
    $('cText').value = '';
    setTimeout(() => $('dlgContact').close(), 1800);
  } catch (err) { msg(err.message, 'err'); }
  $('cSend').disabled = false;
});
