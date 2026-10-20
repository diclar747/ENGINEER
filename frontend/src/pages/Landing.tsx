import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, ArrowDown, ArrowRight, AudioLines, BellRing, Bot, CalendarDays,
  Check, ChevronDown, ClipboardPlus, CreditCard, Download, FileHeart,
  FileText, Globe2, HeartPulse, LockKeyhole, MapPin, Menu, MessageCircle,
  QrCode, ScanLine, ShieldCheck, Smartphone, Sparkles, Stethoscope, X,
} from 'lucide-react';
import { api, API_BASE_URL } from '../utils/api';
import { SUPPORT_EMAIL, supportMailto } from '../utils/support';
import './Landing.css';

type Region = 'paraguay' | 'brasil' | 'usa';
type PriceInfo = {
  plans: { monthly: { amount: number; formatted: string }; annual: { amount: number; formatted: string } };
};
type Prices = Record<Region, PriceInfo>;

const regions: { id: Region; flag: string; name: string }[] = [
  { id: 'paraguay', flag: '🇵🇾', name: 'Paraguay' },
  { id: 'brasil', flag: '🇧🇷', name: 'Brasil' },
  { id: 'usa', flag: '🇺🇸', name: 'EE. UU. / USD' },
];

const features = [
  {
    icon: QrCode,
    index: '01',
    title: 'Ficha de emergencia por QR',
    text: 'Los datos esenciales para asistir al titular se muestran al escanear su código, sin iniciar sesión. El acceso queda registrado.',
    color: 'mint',
  },
  {
    icon: FileHeart,
    index: '02',
    title: 'Bóveda médica personal',
    text: 'Perfil de salud, estudios, recetas, medicación y contactos de emergencia reunidos en un mismo lugar.',
    color: 'sky',
  },
  {
    icon: BellRing,
    index: '03',
    title: 'Recordatorios que acompañan',
    text: 'Organizá tomas de medicación y citas desde el calendario o conversando con el asistente.',
    color: 'peach',
  },
  {
    icon: MessageCircle,
    index: '04',
    title: 'Asistente por web y WhatsApp',
    text: 'Registrate y gestioná consultas, documentos y recordatorios mediante una conversación guiada.',
    color: 'lilac',
  },
  {
    icon: CalendarDays,
    index: '05',
    title: 'Turnos con profesionales',
    text: 'Explorá especialidades y horarios del catálogo disponible; las reservas confirmadas generan avisos para paciente y doctor.',
    color: 'mint',
  },
  {
    icon: Download,
    index: '06',
    title: 'Tu información, portable',
    text: 'Descargá una copia de tu historial y documentos en un archivo protegido con tu PIN.',
    color: 'sky',
  },
];

const steps = [
  { n: '01', icon: MessageCircle, title: 'Creá tu cuenta', text: 'Empezá en el asistente web con tu número de celular y completá el perfil paso a paso.' },
  { n: '02', icon: ClipboardPlus, title: 'Armá tu pasaporte', text: 'Agregá tus datos médicos, contactos, estudios, medicamentos y recordatorios.' },
  { n: '03', icon: QrCode, title: 'Llevá tu QR', text: 'Compartilo desde el teléfono o descargá el kit para imprimirlo como sticker.' },
  { n: '04', icon: ShieldCheck, title: 'Mantené el control', text: 'Consultá tus accesos, protegé la información privada con PIN y exportá tus datos.' },
];

const faqs = [
  {
    q: '¿Qué ve alguien que escanea mi QR?',
    a: 'La ficha pública muestra información útil en una emergencia, como grupo sanguíneo, alergias, condiciones relevantes, medicación y el contacto principal. Los estudios y datos privados requieren el PIN para el modo consulta.',
  },
  {
    q: '¿Puedo registrarme sin usar WhatsApp?',
    a: 'Sí. El asistente de registro funciona en esta web. Para recibir códigos de acceso y mensajes automáticos por WhatsApp, el bot debe estar conectado al servicio.',
  },
  {
    q: '¿Puedo llevarme mis documentos?',
    a: 'Sí. Desde tu pasaporte podés descargar un archivo con tu historial y documentos. El archivo se protege con tu PIN y requiere una aplicación compatible con ZIP AES-256 para abrirlo.',
  },
  {
    q: '¿Cómo funcionan los recordatorios y los turnos?',
    a: 'Podés crear avisos de medicación y citas personales. Si hay doctores activos en el catálogo, el asistente también puede mostrar horarios libres para reservar; una consulta con costo se confirma al acreditarse el pago.',
  },
  {
    q: '¿Qué ocurre si mi suscripción vence?',
    a: 'El sistema envía avisos de renovación. Tras el período de espera configurado, el QR puede quedar inactivo hasta regularizar el pago; los datos permanecen guardados según el flujo vigente del servicio.',
  },
];

export function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [region, setRegion] = useState<Region>('paraguay');
  const [prices, setPrices] = useState<Prices | null>(null);
  const hasSession = Boolean(localStorage.getItem('biopass_token'));

  useEffect(() => {
    let mounted = true;
    api.get('/payments/methods')
      .then(({ data }) => { if (mounted) setPrices(data as Prices); })
      .catch(() => { /* Show plans without stale prices if the service is unavailable. */ });
    return () => { mounted = false; };
  }, []);

  const closeMenu = () => setMenuOpen(false);
  const selectedPrice = prices?.[region];
  const twoMonthsIncluded = Boolean(selectedPrice && Math.abs(selectedPrice.plans.annual.amount - selectedPrice.plans.monthly.amount * 10) < 0.001);

  return (
    <div className="landing" id="inicio">
      <div className="landing-announcement">
        <span className="landing-announcement-dot" />
        Tu salud, organizada para los momentos que importan.
        <a href="#como-funciona">Descubrí cómo funciona <ArrowRight size={13} /></a>
      </div>

      <header className="landing-header">
        <div className="landing-container landing-header-inner">
          <a className="landing-brand" href="#inicio" onClick={closeMenu} aria-label="Bio-Pass, ir al inicio">
            <span className="landing-brand-icon"><HeartPulse size={22} strokeWidth={2.5} /></span>
            <span className="landing-brand-word">bio<span>pass</span><small>HEALTH PASSPORT</small></span>
          </a>
          <nav className={`landing-nav${menuOpen ? ' is-open' : ''}`} aria-label="Navegación principal">
            <a href="#solucion" onClick={closeMenu}>La solución</a>
            <a href="#como-funciona" onClick={closeMenu}>Cómo funciona</a>
            <a href="#asistente" onClick={closeMenu}>Asistente</a>
            <a href="#planes" onClick={closeMenu}>Planes</a>
            <a href="#preguntas" onClick={closeMenu}>Preguntas</a>
          </nav>
          <div className="landing-header-actions">
            <Link className="landing-login" to={hasSession ? '/dashboard' : '/login'}>{hasSession ? 'Mi pasaporte' : 'Ingresar'}</Link>
            <Link className="landing-button landing-button-small" to="/registro">Crear mi Bio-Pass <ArrowRight size={16} /></Link>
          </div>
          <button className="landing-menu-toggle" type="button" aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </header>

      <main>
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-container landing-hero-grid">
            <div className="landing-hero-copy">
              <div className="landing-eyebrow"><span className="landing-eyebrow-line" /> TU SALUD, SIEMPRE CONTIGO</div>
              <h1 id="landing-title">Tu historia de salud,<br /><em>lista cuando</em><br />más importa<span className="landing-dot">.</span></h1>
              <p>Un pasaporte médico inteligente que reúne lo esencial de tu salud y lo pone al alcance cuando necesitás compartirlo. Desde un QR de emergencia hasta tus estudios, recordatorios y citas.</p>
              <div className="landing-hero-actions">
                <Link className="landing-button landing-button-primary" to="/registro">Crear mi Bio-Pass <ArrowRight size={19} /></Link>
                <a className="landing-text-link" href="#solucion">Explorar la solución <ArrowDown size={16} /></a>
              </div>
              <div className="landing-hero-mini"><span className="landing-mini-icon"><ShieldCheck size={17} /></span><span>Acceso privado con PIN <i /> QR listo para compartir <i /> Control de tus datos</span></div>
            </div>
            <div className="landing-hero-visual">
              <div className="landing-photo-frame"><img src="/landing/hero-care.jpg" alt="Paciente conversando con una profesional de salud en un consultorio luminoso" loading="eager" /></div>
              <div className="landing-float-card landing-float-top"><span className="landing-float-icon"><HeartPulse size={19} /></span><span><strong>Tu información esencial</strong><small>Siempre a tu alcance</small></span><Check size={15} className="landing-float-check" /></div>
              <div className="landing-float-card landing-float-bottom"><span className="landing-float-qr"><QrCode size={34} strokeWidth={1.6} /></span><span><small>PASAPORTE MÉDICO</small><strong>Un QR. Una historia.</strong><small>Información útil al instante</small></span></div>
              <div className="landing-visual-mark">CUIDAR ES ESTAR PREPARADOS <span>✳</span></div>
            </div>
          </div>
          <div className="landing-container landing-hero-bottom"><span>01 / UNA NUEVA FORMA DE CUIDARTE</span><span>DESLIZÁ PARA DESCUBRIR <ArrowDown size={14} /></span></div>
        </section>

        <section className="landing-trust" aria-label="Aspectos principales">
          <div className="landing-container landing-trust-grid">
            <div><QrCode size={23} /><span><strong>QR de emergencia</strong><small>Información esencial disponible</small></span></div>
            <div><LockKeyhole size={23} /><span><strong>Privacidad en capas</strong><small>Datos privados protegidos con PIN</small></span></div>
            <div><Smartphone size={23} /><span><strong>Web y WhatsApp</strong><small>Asistente en tus canales cotidianos</small></span></div>
            <div><Globe2 size={23} /><span><strong>Tu historial contigo</strong><small>Acceso y exportación desde tu cuenta</small></span></div>
          </div>
        </section>

        <section className="landing-section landing-features" id="solucion">
          <div className="landing-container">
            <div className="landing-section-head">
              <div><span className="landing-kicker">LA SOLUCIÓN</span><h2>Todo lo que necesitás para<br /><em>cuidar tu salud, conectado.</em></h2></div>
              <p>Tu información no debería estar dispersa. Bio-Pass conecta tu perfil médico, tus documentos y las herramientas que te acompañan cada día.</p>
            </div>
            <div className="landing-feature-grid">
              {features.map(({ icon: Icon, index, title, text, color }) => (
                <article className={`landing-feature-card landing-feature-${color}`} key={title}>
                  <div className="landing-feature-card-top"><span className="landing-feature-icon"><Icon size={27} strokeWidth={1.7} /></span><span className="landing-feature-index">{index} / 06</span></div>
                  <div><h3>{title}</h3><p>{text}</p></div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-section landing-emergency" id="emergencia">
          <div className="landing-container landing-emergency-grid">
            <div className="landing-emergency-visual"><img src="/landing/qr-care.jpg" alt="Paciente comparte su código QR médico con una profesional de salud" loading="lazy" /><span className="landing-image-caption"><span className="landing-caption-dot" /> Un gesto simple. Información que ayuda.</span></div>
            <div className="landing-emergency-copy"><span className="landing-kicker">PREPARADO PARA LO INESPERADO</span><h2>Cuando cada segundo cuenta, <em>lo esencial está ahí.</em></h2><p>Tu QR abre una ficha de emergencia con la información que elegiste registrar: grupo sanguíneo, alergias, condiciones, medicación y contacto principal. Un profesional puede consultar el resto con tu PIN.</p>
              <ul className="landing-check-list"><li><Check size={16} /> Acceso público a la ficha esencial</li><li><Check size={16} /> Estudios y datos privados en modo consulta con PIN</li><li><Check size={16} /> Registro del escaneo y avisos cuando los canales estén activos</li></ul>
              <Link className="landing-inline-link" to="/registro">Preparar mi pasaporte <ArrowRight size={17} /></Link>
            </div>
          </div>
        </section>

        <section className="landing-section landing-steps" id="como-funciona">
          <div className="landing-container">
            <div className="landing-center-head"><span className="landing-kicker">SIMPLE DESDE EL PRIMER PASO</span><h2>Así funciona <em>Bio-Pass.</em></h2><p>Una experiencia pensada para que tu información esté organizada y sea fácil de usar.</p></div>
            <div className="landing-step-grid">{steps.map(({ n, icon: Icon, title, text }) => <article key={n} className="landing-step"><span className="landing-step-number">{n}</span><span className="landing-step-icon"><Icon size={24} /></span><h3>{title}</h3><p>{text}</p></article>)}</div>
          </div>
        </section>

        <section className="landing-section landing-assistant" id="asistente">
          <div className="landing-container landing-assistant-grid">
            <div className="landing-assistant-copy"><span className="landing-kicker landing-kicker-light">TU ASISTENTE DE SALUD</span><h2>Tu salud también se organiza <em>conversando.</em></h2><p>El asistente web guía el registro y ayuda a gestionar tu información. El bot de WhatsApp acompaña con consultas, documentos, medicamentos, turnos y avisos cuando el canal está conectado.</p><div className="landing-assistant-points"><span><Bot size={18} /> Chat guiado</span><span><AudioLines size={18} /> Audio y voz según disponibilidad</span><span><Sparkles size={18} /> Lectura asistida de documentos</span></div><Link className="landing-button landing-button-light" to="/registro">Hablar con el asistente <ArrowRight size={18} /></Link></div>
            <div className="landing-chat-scene" aria-label="Ejemplo ilustrativo de conversación con el asistente"><div className="landing-chat-orb"><AudioLines size={31} /></div><div className="landing-chat-card"><div className="landing-chat-head"><span className="landing-chat-avatar"><HeartPulse size={20} /></span><span><strong>Asistente Bio-Pass</strong><small>Una conversación a tu ritmo</small></span><span className="landing-online-dot" /></div><div className="landing-chat-body"><div className="landing-chat-message bot-message">Hola 👋 ¿En qué puedo ayudarte hoy?</div><div className="landing-chat-message user-message">Quiero organizar mis medicamentos y mi próxima cita.</div><div className="landing-chat-message bot-message">Perfecto. Podemos cargar tus recordatorios paso a paso.</div><div className="landing-chat-options"><span>💊 Medicación</span><span>📅 Citas</span><span>📄 Estudios</span></div></div><div className="landing-chat-input">Escribí tu mensaje... <span><ArrowRight size={15} /></span></div></div><span className="landing-chat-disclaimer">Vista ilustrativa del asistente</span></div>
          </div>
        </section>

        <section className="landing-section landing-ecosystem">
          <div className="landing-container"><div className="landing-section-head"><div><span className="landing-kicker">UN ECOSISTEMA PARA TU DÍA A DÍA</span><h2>Más que una ficha.<br /><em>Un espacio para cuidarte.</em></h2></div><p>Herramientas conectadas a tu pasaporte para ordenar lo importante y compartirlo cuando lo decidas.</p></div><div className="landing-ecosystem-grid"><article className="landing-ecosystem-main"><div className="landing-ecosystem-icon"><FileText size={28} /></div><h3>Estudios y recetas, en un solo lugar.</h3><p>Subí documentos a tu bóveda, consultalos cuando los necesites y encontrá más rápido tu información médica.</p><div className="landing-doc-stack"><span><FileHeart size={19} /> Estudios médicos <Check size={15} /></span><span><FileText size={19} /> Recetas y documentos <Check size={15} /></span><span><Activity size={19} /> Perfil de salud <Check size={15} /></span></div></article><article className="landing-ecosystem-small"><div className="landing-ecosystem-icon"><Stethoscope size={27} /></div><h3>Turnos con doctores</h3><p>Buscá profesionales del catálogo, elegí un horario libre y seguí tus citas desde el asistente.</p><div className="landing-small-tag"><CalendarDays size={15} /> Agenda conectada</div></article><article className="landing-ecosystem-small"><div className="landing-ecosystem-icon"><BellRing size={27} /></div><h3>Recordatorios útiles</h3><p>Planificá medicamentos y consultas. Los avisos se envían por los canales que tengas activos.</p><div className="landing-small-tag"><BellRing size={15} /> A tu ritmo</div></article></div></div>
        </section>

        <section className="landing-section landing-control"><div className="landing-container landing-control-grid"><div><span className="landing-kicker">TUS DATOS, TU DECISIÓN</span><h2>Diseñado para darte <em>más control.</em></h2><p>La ficha pública se limita a lo útil en una emergencia. El historial más sensible se abre con PIN; los archivos se entregan mediante enlaces temporales y podés descargar una copia de tu información.</p><Link className="landing-inline-link" to={hasSession ? '/audit-logs' : '/registro'}>{hasSession ? 'Ver mis accesos' : 'Comenzar con Bio-Pass'} <ArrowRight size={17} /></Link></div><div className="landing-control-list"><div><span><LockKeyhole size={21} /></span><strong>Acceso privado con PIN</strong><p>Separación entre ficha de rescate y modo consulta.</p></div><div><span><ScanLine size={21} /></span><strong>Trazabilidad de escaneos</strong><p>Revisá accesos registrados en tu cuenta.</p></div><div><span><Download size={21} /></span><strong>Exportación del historial</strong><p>Tu copia protegida, lista para descargar.</p></div><div><span><MapPin size={21} /></span><strong>Ubicación del escaneo</strong><p>Aproximada por IP o precisa si el navegador la comparte.</p></div></div></div></section>

        <section className="landing-section landing-pricing" id="planes"><div className="landing-container"><div className="landing-center-head"><span className="landing-kicker">PLANES Y ACCESO</span><h2>Un plan para seguir <em>cuidándote.</em></h2><p>Elegí tu país para ver los precios vigentes del servicio.</p></div><div className="landing-region-tabs" role="group" aria-label="Seleccionar país de facturación">{regions.map((item) => <button key={item.id} type="button" className={region === item.id ? 'active' : ''} onClick={() => setRegion(item.id)} aria-pressed={region === item.id}><span>{item.flag}</span> {item.name}</button>)}</div><div className="landing-plan-grid"><article className="landing-plan-card"><span className="landing-plan-type">FLEXIBLE</span><h3>Mensual</h3><p>Tu pasaporte y herramientas, mes a mes.</p><div className="landing-plan-price">{selectedPrice?.plans.monthly.formatted ?? 'Consultar precio'}{selectedPrice && <small> / mes</small>}</div><ul><li><Check size={16} /> QR y ficha de emergencia</li><li><Check size={16} /> Bóveda y documentos</li><li><Check size={16} /> Asistente y recordatorios</li></ul><Link to="/registro">Empezar ahora <ArrowRight size={16} /></Link></article><article className="landing-plan-card landing-plan-featured"><span className="landing-plan-badge">{twoMonthsIncluded ? 'DOS MESES INCLUIDOS' : 'PLAN ANUAL'}</span><span className="landing-plan-type">MÁS CONTINUIDAD</span><h3>Anual</h3><p>{twoMonthsIncluded ? 'Doce meses de Bio-Pass al valor de diez.' : 'Un pago para todo el año.'}</p><div className="landing-plan-price">{selectedPrice?.plans.annual.formatted ?? 'Consultar precio'}{selectedPrice && <small> / año</small>}</div><ul><li><Check size={16} /> Todo lo incluido en el mensual</li><li><Check size={16} /> Un solo pago anual</li><li><Check size={16} /> {twoMonthsIncluded ? 'Ahorro frente a doce cuotas' : 'Vigencia de doce meses'}</li></ul><Link to="/registro">Elegir plan anual <ArrowRight size={16} /></Link></article></div><p className="landing-pricing-note"><CreditCard size={15} /> Los medios de pago disponibles se confirman al generar la orden. Los precios pueden actualizarse desde la administración.</p></div></section>

        <section className="landing-section landing-faq" id="preguntas"><div className="landing-container landing-faq-grid"><div><span className="landing-kicker">PREGUNTAS FRECUENTES</span><h2>Respuestas para empezar <em>con confianza.</em></h2><p>Si necesitás ayuda, nuestro equipo puede orientarte por correo.</p><a href={supportMailto('Consulta sobre Bio-Pass')} className="landing-inline-link">Contactar soporte <ArrowRight size={17} /></a></div><div className="landing-faq-list">{faqs.map(({ q, a }) => <details key={q}><summary>{q}<ChevronDown size={19} /></summary><p>{a}</p></details>)}</div></div></section>

        <section className="landing-final-cta"><div className="landing-container landing-final-inner"><div><span className="landing-kicker landing-kicker-light">EMPEZÁ HOY</span><h2>Tu salud tiene una historia.<br /><em>Llevala contigo.</em></h2><p>Prepará tu pasaporte médico en una conversación sencilla.</p></div><div><Link className="landing-button landing-button-white" to="/registro">Crear mi Bio-Pass <ArrowRight size={19} /></Link><span>También podés <Link to="/login">iniciar sesión</Link> si ya tenés cuenta.</span></div></div></section>
      </main>

      <footer className="landing-footer"><div className="landing-container"><div className="landing-footer-main"><div><a className="landing-brand" href="#inicio"><span className="landing-brand-icon"><HeartPulse size={21} /></span><span className="landing-brand-word">bio<span>pass</span><small>HEALTH PASSPORT</small></span></a><p>Tu pasaporte médico inteligente. Información esencial cuando importa, herramientas útiles todos los días.</p></div><div><strong>Explorá</strong><a href="#solucion">La solución</a><a href="#como-funciona">Cómo funciona</a><a href="#asistente">Asistente</a><a href="#planes">Planes</a></div><div><strong>Tu cuenta</strong><Link to="/registro">Crear Bio-Pass</Link><Link to="/login">Ingresar</Link><a href={`${API_BASE_URL}/legal/terminos`} target="_blank" rel="noreferrer">Términos y condiciones</a></div><div><strong>Contacto</strong><a href={supportMailto()}>{SUPPORT_EMAIL}</a><span>Paraguay · Brasil · EE. UU.</span></div></div><div className="landing-footer-bottom"><span>© {new Date().getFullYear()} Doorway Cortex Bio-Pass. Todos los derechos reservados.</span><span>Hecho para cuidar lo que importa. <HeartPulse size={14} /></span></div></div></footer>
    </div>
  );
}
