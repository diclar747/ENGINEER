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

type Lang = 'es' | 'pt' | 'en';
const LANGS: { id: Lang; flag: string; label: string }[] = [
  { id: 'es', flag: '🇵🇾', label: 'Español' },
  { id: 'pt', flag: '🇧🇷', label: 'Português' },
  { id: 'en', flag: '🇬🇧', label: 'English' },
];

type Dict = {
  waText: string;
  announce: string; announceCta: string;
  nav: [string, string, string, string, string];
  login: string; myPass: string; createCta: string;
  heroEyebrow: string; heroTitle: [string, string, string]; heroP: string;
  heroExplore: string; heroMini: string; heroBottomL: string; heroBottomR: string;
  heroMark: string; floatTopA: string; floatTopB: string; floatQrA: string; floatQrB: string; floatQrC: string;
  trust: { t: string; s: string }[];
  solKicker: string; solH2a: string; solH2em: string; solP: string;
  features: { title: string; text: string }[];
  emgKicker: string; emgH2a: string; emgH2em: string; emgP: string; emgList: string[]; emgLink: string; emgCaption: string;
  stepsKicker: string; stepsH2a: string; stepsH2em: string; stepsP: string;
  steps: { title: string; text: string }[];
  asKicker: string; asH2a: string; asH2em: string; asP: string; asPoints: string[]; asBtn: string;
  asChatName: string; asChatSub: string; asMsg1: string; asMsg2: string; asMsg3: string; asOpts: string[]; asInput: string; asDisc: string;
  ecoKicker: string; ecoH2a: string; ecoH2em: string; ecoP: string;
  ecoMainT: string; ecoMainP: string; ecoTags: string[];
  ecoSmall1T: string; ecoSmall1P: string; ecoSmall1Tag: string;
  ecoSmall2T: string; ecoSmall2P: string; ecoSmall2Tag: string;
  ctrlKicker: string; ctrlH2a: string; ctrlH2em: string; ctrlP: string; ctrlLink: string; ctrlSeeAccess: string;
  ctrl: { t: string; p: string }[];
  priKicker: string; priH2a: string; priH2em: string; priP: string;
  regions: Record<Region, string>;
  planFlex: string; planMonthly: string; planMonthlyP: string; perMonth: string; planMonthlyFeat: string[]; startNow: string;
  twoMonths: string; annualPlan: string; moreCont: string; planAnnual: string; planAnnual2m: string; planAnnual1: string; perYear: string; planAnnualFeat2m: string; planAnnualFeat1: string; chooseAnnual: string;
  consult: string; priNote: string;
  faqKicker: string; faqH2a: string; faqH2em: string; faqP: string; faqContact: string;
  faqs: { q: string; a: string }[];
  ctaKicker: string; ctaH2a: string; ctaH2em: string; ctaP: string; ctaBtn: string; ctaAlsoA: string; ctaAlsoLink: string; ctaAlsoB: string;
  ftTagline: string; ftExplore: string; ftAccount: string; ftCreate: string; ftTerms: string; ftContact: string; ftCoverage: string; ftRights: string; ftMade: string;
  waLabel: string;
};

const T: Record<Lang, Dict> = {
  es: {
    waText: 'Hola, deseo más información de Bio-Pass',
    announce: 'Tu salud, organizada para los momentos que importan.', announceCta: 'Descubrí cómo funciona',
    nav: ['La solución', 'Cómo funciona', 'Asistente', 'Planes', 'Preguntas'],
    login: 'Ingresar', myPass: 'Mi pasaporte', createCta: 'Crear mi Bio-Pass',
    heroEyebrow: 'TU SALUD, SIEMPRE CONTIGO', heroTitle: ['Tu historia de salud,', 'lista cuando', 'más importa'],
    heroP: 'Un pasaporte médico inteligente que reúne lo esencial de tu salud y lo pone al alcance cuando necesitás compartirlo. Desde un QR de emergencia hasta tus estudios, recordatorios y citas.',
    heroExplore: 'Explorar la solución', heroMini: 'Acceso privado con PIN · QR listo para compartir · Control de tus datos',
    heroBottomL: '01 / UNA NUEVA FORMA DE CUIDARTE', heroBottomR: 'DESLIZÁ PARA DESCUBRIR', heroMark: 'CUIDAR ES ESTAR PREPARADOS',
    floatTopA: 'Tu información esencial', floatTopB: 'Siempre a tu alcance', floatQrA: 'PASAPORTE MÉDICO', floatQrB: 'Un QR. Una historia.', floatQrC: 'Información útil al instante',
    trust: [
      { t: 'QR de emergencia', s: 'Información esencial disponible' },
      { t: 'Privacidad en capas', s: 'Datos privados protegidos con PIN' },
      { t: 'Web y WhatsApp', s: 'Asistente en tus canales cotidianos' },
      { t: 'Tu historial contigo', s: 'Acceso y exportación desde tu cuenta' },
    ],
    solKicker: 'LA SOLUCIÓN', solH2a: 'Todo lo que necesitás para\n', solH2em: 'cuidar tu salud, conectado.',
    solP: 'Tu información no debería estar dispersa. Bio-Pass conecta tu perfil médico, tus documentos y las herramientas que te acompañan cada día.',
    features: [
      { title: 'Ficha de emergencia por QR', text: 'Los datos esenciales para asistir al titular se muestran al escanear su código, sin iniciar sesión. El acceso queda registrado.' },
      { title: 'Bóveda médica personal', text: 'Perfil de salud, estudios, recetas, medicación y contactos de emergencia reunidos en un mismo lugar.' },
      { title: 'Recordatorios que acompañan', text: 'Organizá tomas de medicación y citas desde el calendario o conversando con el asistente.' },
      { title: 'Asistente por web y WhatsApp', text: 'Registrate y gestioná consultas, documentos y recordatorios mediante una conversación guiada.' },
      { title: 'Turnos con profesionales', text: 'Explorá especialidades y horarios del catálogo disponible; las reservas confirmadas generan avisos para paciente y doctor.' },
      { title: 'Tu información, portable', text: 'Descargá una copia de tu historial y documentos en un archivo protegido con tu PIN.' },
    ],
    emgKicker: 'PREPARADO PARA LO INESPERADO', emgH2a: 'Cuando cada segundo cuenta, ', emgH2em: 'lo esencial está ahí.',
    emgP: 'Tu QR abre una ficha de emergencia con la información que elegiste registrar: grupo sanguíneo, alergias, condiciones, medicación y contacto principal. Un profesional puede consultar el resto con tu PIN.',
    emgList: ['Acceso público a la ficha esencial', 'Estudios y datos privados en modo consulta con PIN', 'Registro del escaneo y avisos cuando los canales estén activos'],
    emgLink: 'Preparar mi pasaporte', emgCaption: 'Un gesto simple. Información que ayuda.',
    stepsKicker: 'SIMPLE DESDE EL PRIMER PASO', stepsH2a: 'Así funciona ', stepsH2em: 'Bio-Pass.', stepsP: 'Una experiencia pensada para que tu información esté organizada y sea fácil de usar.',
    steps: [
      { title: 'Creá tu cuenta', text: 'Empezá en el asistente web con tu número de celular y completá el perfil paso a paso.' },
      { title: 'Armá tu pasaporte', text: 'Agregá tus datos médicos, contactos, estudios, medicamentos y recordatorios.' },
      { title: 'Llevá tu QR', text: 'Compartilo desde el teléfono o descargá el kit para imprimirlo como sticker.' },
      { title: 'Mantené el control', text: 'Consultá tus accesos, protegé la información privada con PIN y exportá tus datos.' },
    ],
    asKicker: 'TU ASISTENTE DE SALUD', asH2a: 'Tu salud también se organiza ', asH2em: 'conversando.',
    asP: 'El asistente web guía el registro y ayuda a gestionar tu información. El bot de WhatsApp acompaña con consultas, documentos, medicamentos, turnos y avisos cuando el canal está conectado.',
    asPoints: ['Chat guiado', 'Audio y voz según disponibilidad', 'Lectura asistida de documentos'], asBtn: 'Hablar con el asistente',
    asChatName: 'Asistente Bio-Pass', asChatSub: 'Una conversación a tu ritmo', asMsg1: 'Hola 👋 ¿En qué puedo ayudarte hoy?', asMsg2: 'Quiero organizar mis medicamentos y mi próxima cita.', asMsg3: 'Perfecto. Podemos cargar tus recordatorios paso a paso.',
    asOpts: ['💊 Medicación', '📅 Citas', '📄 Estudios'], asInput: 'Escribí tu mensaje...', asDisc: 'Vista ilustrativa del asistente',
    ecoKicker: 'UN ECOSISTEMA PARA TU DÍA A DÍA', ecoH2a: 'Más que una ficha.\n', ecoH2em: 'Un espacio para cuidarte.',
    ecoP: 'Herramientas conectadas a tu pasaporte para ordenar lo importante y compartirlo cuando lo decidas.',
    ecoMainT: 'Estudios y recetas, en un solo lugar.', ecoMainP: 'Subí documentos a tu bóveda, consultalos cuando los necesites y encontrá más rápido tu información médica.',
    ecoTags: ['Estudios médicos', 'Recetas y documentos', 'Perfil de salud'],
    ecoSmall1T: 'Turnos con doctores', ecoSmall1P: 'Buscá profesionales del catálogo, elegí un horario libre y seguí tus citas desde el asistente.', ecoSmall1Tag: 'Agenda conectada',
    ecoSmall2T: 'Recordatorios útiles', ecoSmall2P: 'Planificá medicamentos y consultas. Los avisos se envían por los canales que tengas activos.', ecoSmall2Tag: 'A tu ritmo',
    ctrlKicker: 'TUS DATOS, TU DECISIÓN', ctrlH2a: 'Diseñado para darte ', ctrlH2em: 'más control.',
    ctrlP: 'La ficha pública se limita a lo útil en una emergencia. El historial más sensible se abre con PIN; los archivos se entregan mediante enlaces temporales y podés descargar una copia de tu información.',
    ctrlLink: 'Comenzar con Bio-Pass', ctrlSeeAccess: 'Ver mis accesos',
    ctrl: [
      { t: 'Acceso privado con PIN', p: 'Separación entre ficha de rescate y modo consulta.' },
      { t: 'Trazabilidad de escaneos', p: 'Revisá accesos registrados en tu cuenta.' },
      { t: 'Exportación del historial', p: 'Tu copia protegida, lista para descargar.' },
      { t: 'Ubicación del escaneo', p: 'Aproximada por IP o precisa si el navegador la comparte.' },
    ],
    priKicker: 'PLANES Y ACCESO', priH2a: 'Un plan para seguir ', priH2em: 'cuidándote.', priP: 'Elegí tu país para ver los precios vigentes del servicio.',
    regions: { paraguay: 'Paraguay', brasil: 'Brasil', usa: 'EE. UU. / USD' },
    planFlex: 'FLEXIBLE', planMonthly: 'Mensual', planMonthlyP: 'Tu pasaporte y herramientas, mes a mes.', perMonth: ' / mes',
    planMonthlyFeat: ['QR y ficha de emergencia', 'Bóveda y documentos', 'Asistente y recordatorios'], startNow: 'Empezar ahora',
    twoMonths: 'DOS MESES INCLUIDOS', annualPlan: 'PLAN ANUAL', moreCont: 'MÁS CONTINUIDAD', planAnnual: 'Anual',
    planAnnual2m: 'Doce meses de Bio-Pass al valor de diez.', planAnnual1: 'Un pago para todo el año.', perYear: ' / año',
    planAnnualFeat2m: 'Ahorro frente a doce cuotas', planAnnualFeat1: 'Vigencia de doce meses', chooseAnnual: 'Elegir plan anual',
    consult: 'Consultar precio', priNote: 'Los medios de pago disponibles se confirman al generar la orden. Los precios pueden actualizarse desde la administración.',
    faqKicker: 'PREGUNTAS FRECUENTES', faqH2a: 'Respuestas para empezar ', faqH2em: 'con confianza.', faqP: 'Si necesitás ayuda, nuestro equipo puede orientarte por correo.', faqContact: 'Contactar soporte',
    faqs: [
      { q: '¿Qué ve alguien que escanea mi QR?', a: 'La ficha pública muestra información útil en una emergencia, como grupo sanguíneo, alergias, condiciones relevantes, medicación y el contacto principal. Los estudios y datos privados requieren el PIN para el modo consulta.' },
      { q: '¿Puedo registrarme sin usar WhatsApp?', a: 'Sí. El asistente de registro funciona en esta web. Para recibir códigos de acceso y mensajes automáticos por WhatsApp, el bot debe estar conectado al servicio.' },
      { q: '¿Puedo llevarme mis documentos?', a: 'Sí. Desde tu pasaporte podés descargar un archivo con tu historial y documentos. El archivo se protege con tu PIN y requiere una aplicación compatible con ZIP AES-256 para abrirlo.' },
      { q: '¿Cómo funcionan los recordatorios y los turnos?', a: 'Podés crear avisos de medicación y citas personales. Si hay doctores activos en el catálogo, el asistente también puede mostrar horarios libres para reservar; una consulta con costo se confirma al acreditarse el pago.' },
      { q: '¿Qué ocurre si mi suscripción vence?', a: 'El sistema envía avisos de renovación. Tras el período de espera configurado, el QR puede quedar inactivo hasta regularizar el pago; los datos permanecen guardados según el flujo vigente del servicio.' },
    ],
    ctaKicker: 'EMPEZÁ HOY', ctaH2a: 'Tu salud tiene una historia.\n', ctaH2em: 'Llevala contigo.', ctaP: 'Prepará tu pasaporte médico en una conversación sencilla.',
    ctaBtn: 'Crear mi Bio-Pass', ctaAlsoA: 'También podés ', ctaAlsoLink: 'iniciar sesión', ctaAlsoB: ' si ya tenés cuenta.',
    ftTagline: 'Tu pasaporte médico inteligente. Información esencial cuando importa, herramientas útiles todos los días.',
    ftExplore: 'Explorá', ftAccount: 'Tu cuenta', ftCreate: 'Crear Bio-Pass', ftTerms: 'Términos y condiciones', ftContact: 'Contacto',
    ftCoverage: 'Paraguay · Brasil · EE. UU.', ftRights: 'Todos los derechos reservados.', ftMade: 'Hecho para cuidar lo que importa.',
    waLabel: '¿Dudas? Escribinos 💬',
  },
  pt: {
    waText: 'Olá, gostaria de mais informações sobre o Bio-Pass',
    announce: 'Sua saúde, organizada para os momentos que importam.', announceCta: 'Descubra como funciona',
    nav: ['A solução', 'Como funciona', 'Assistente', 'Planos', 'Perguntas'],
    login: 'Entrar', myPass: 'Meu passaporte', createCta: 'Criar meu Bio-Pass',
    heroEyebrow: 'SUA SAÚDE, SEMPRE COM VOCÊ', heroTitle: ['Sua história de saúde,', 'pronta quando', 'mais importa'],
    heroP: 'Um passaporte médico inteligente que reúne o essencial da sua saúde e o deixa à mão quando você precisa compartilhar. De um QR de emergência aos seus exames, lembretes e consultas.',
    heroExplore: 'Explorar a solução', heroMini: 'Acesso privado com PIN · QR pronto para compartilhar · Controle dos seus dados',
    heroBottomL: '01 / UMA NOVA FORMA DE SE CUIDAR', heroBottomR: 'DESLIZE PARA DESCOBRIR', heroMark: 'CUIDAR É ESTAR PREPARADO',
    floatTopA: 'Sua informação essencial', floatTopB: 'Sempre ao seu alcance', floatQrA: 'PASSAPORTE MÉDICO', floatQrB: 'Um QR. Uma história.', floatQrC: 'Informação útil na hora',
    trust: [
      { t: 'QR de emergência', s: 'Informação essencial disponível' },
      { t: 'Privacidade em camadas', s: 'Dados privados protegidos com PIN' },
      { t: 'Web e WhatsApp', s: 'Assistente nos seus canais do dia a dia' },
      { t: 'Seu histórico com você', s: 'Acesso e exportação pela sua conta' },
    ],
    solKicker: 'A SOLUÇÃO', solH2a: 'Tudo o que você precisa para\n', solH2em: 'cuidar da sua saúde, conectado.',
    solP: 'Sua informação não deveria estar dispersa. O Bio-Pass conecta seu perfil médico, seus documentos e as ferramentas que acompanham você todos os dias.',
    features: [
      { title: 'Ficha de emergência por QR', text: 'Os dados essenciais para ajudar o titular aparecem ao escanear o código, sem login. O acesso fica registrado.' },
      { title: 'Cofre médico pessoal', text: 'Perfil de saúde, exames, receitas, medicação e contatos de emergência reunidos em um só lugar.' },
      { title: 'Lembretes que acompanham', text: 'Organize doses de medicação e consultas pelo calendário ou conversando com o assistente.' },
      { title: 'Assistente por web e WhatsApp', text: 'Cadastre-se e gerencie consultas, documentos e lembretes por uma conversa guiada.' },
      { title: 'Consultas com profissionais', text: 'Explore especialidades e horários do catálogo disponível; as reservas confirmadas geram avisos para paciente e médico.' },
      { title: 'Sua informação, portátil', text: 'Baixe uma cópia do seu histórico e documentos em um arquivo protegido com seu PIN.' },
    ],
    emgKicker: 'PREPARADO PARA O INESPERADO', emgH2a: 'Quando cada segundo conta, ', emgH2em: 'o essencial está ali.',
    emgP: 'Seu QR abre uma ficha de emergência com a informação que você escolheu registrar: tipo sanguíneo, alergias, condições, medicação e contato principal. Um profissional pode ver o restante com seu PIN.',
    emgList: ['Acesso público à ficha essencial', 'Exames e dados privados em modo consulta com PIN', 'Registro do escaneamento e avisos quando os canais estiverem ativos'],
    emgLink: 'Preparar meu passaporte', emgCaption: 'Um gesto simples. Informação que ajuda.',
    stepsKicker: 'SIMPLES DESDE O PRIMEIRO PASSO', stepsH2a: 'Assim funciona o ', stepsH2em: 'Bio-Pass.', stepsP: 'Uma experiência pensada para que sua informação fique organizada e fácil de usar.',
    steps: [
      { title: 'Crie sua conta', text: 'Comece no assistente web com seu número de celular e preencha o perfil passo a passo.' },
      { title: 'Monte seu passaporte', text: 'Adicione seus dados médicos, contatos, exames, medicamentos e lembretes.' },
      { title: 'Leve seu QR', text: 'Compartilhe pelo celular ou baixe o kit para imprimir como adesivo.' },
      { title: 'Mantenha o controle', text: 'Veja seus acessos, proteja a informação privada com PIN e exporte seus dados.' },
    ],
    asKicker: 'SEU ASSISTENTE DE SAÚDE', asH2a: 'Sua saúde também se organiza ', asH2em: 'conversando.',
    asP: 'O assistente web guia o cadastro e ajuda a gerenciar sua informação. O bot do WhatsApp acompanha com consultas, documentos, medicamentos, horários e avisos quando o canal está conectado.',
    asPoints: ['Chat guiado', 'Áudio e voz conforme disponibilidade', 'Leitura assistida de documentos'], asBtn: 'Falar com o assistente',
    asChatName: 'Assistente Bio-Pass', asChatSub: 'Uma conversa no seu ritmo', asMsg1: 'Olá 👋 Como posso ajudar hoje?', asMsg2: 'Quero organizar meus medicamentos e minha próxima consulta.', asMsg3: 'Perfeito. Podemos criar seus lembretes passo a passo.',
    asOpts: ['💊 Medicação', '📅 Consultas', '📄 Exames'], asInput: 'Escreva sua mensagem...', asDisc: 'Visualização ilustrativa do assistente',
    ecoKicker: 'UM ECOSSISTEMA PARA O SEU DIA A DIA', ecoH2a: 'Mais que uma ficha.\n', ecoH2em: 'Um espaço para se cuidar.',
    ecoP: 'Ferramentas conectadas ao seu passaporte para organizar o importante e compartilhar quando você decidir.',
    ecoMainT: 'Exames e receitas, em um só lugar.', ecoMainP: 'Suba documentos ao seu cofre, consulte quando precisar e encontre sua informação médica mais rápido.',
    ecoTags: ['Exames médicos', 'Receitas e documentos', 'Perfil de saúde'],
    ecoSmall1T: 'Consultas com médicos', ecoSmall1P: 'Busque profissionais do catálogo, escolha um horário livre e acompanhe suas consultas pelo assistente.', ecoSmall1Tag: 'Agenda conectada',
    ecoSmall2T: 'Lembretes úteis', ecoSmall2P: 'Planeje medicamentos e consultas. Os avisos são enviados pelos canais que você tiver ativos.', ecoSmall2Tag: 'No seu ritmo',
    ctrlKicker: 'SEUS DADOS, SUA DECISÃO', ctrlH2a: 'Projetado para dar a você ', ctrlH2em: 'mais controle.',
    ctrlP: 'A ficha pública se limita ao útil em uma emergência. O histórico mais sensível abre com PIN; os arquivos são entregues por links temporários e você pode baixar uma cópia da sua informação.',
    ctrlLink: 'Começar com o Bio-Pass', ctrlSeeAccess: 'Ver meus acessos',
    ctrl: [
      { t: 'Acesso privado com PIN', p: 'Separação entre ficha de resgate e modo consulta.' },
      { t: 'Rastreabilidade de escaneamentos', p: 'Veja acessos registrados na sua conta.' },
      { t: 'Exportação do histórico', p: 'Sua cópia protegida, pronta para baixar.' },
      { t: 'Localização do escaneamento', p: 'Aproximada por IP ou precisa se o navegador compartilhar.' },
    ],
    priKicker: 'PLANOS E ACESSO', priH2a: 'Um plano para continuar ', priH2em: 'se cuidando.', priP: 'Escolha seu país para ver os preços vigentes do serviço.',
    regions: { paraguay: 'Paraguai', brasil: 'Brasil', usa: 'EUA / USD' },
    planFlex: 'FLEXÍVEL', planMonthly: 'Mensal', planMonthlyP: 'Seu passaporte e ferramentas, mês a mês.', perMonth: ' / mês',
    planMonthlyFeat: ['QR e ficha de emergência', 'Cofre e documentos', 'Assistente e lembretes'], startNow: 'Começar agora',
    twoMonths: 'DOIS MESES INCLUSOS', annualPlan: 'PLANO ANUAL', moreCont: 'MAIS CONTINUIDADE', planAnnual: 'Anual',
    planAnnual2m: 'Doze meses de Bio-Pass pelo valor de dez.', planAnnual1: 'Um pagamento para o ano todo.', perYear: ' / ano',
    planAnnualFeat2m: 'Economia frente a doze parcelas', planAnnualFeat1: 'Validade de doze meses', chooseAnnual: 'Escolher plano anual',
    consult: 'Consultar preço', priNote: 'Os meios de pagamento disponíveis são confirmados ao gerar o pedido. Os preços podem ser atualizados pela administração.',
    faqKicker: 'PERGUNTAS FREQUENTES', faqH2a: 'Respostas para começar ', faqH2em: 'com confiança.', faqP: 'Se precisar de ajuda, nossa equipe pode orientar por e-mail.', faqContact: 'Falar com o suporte',
    faqs: [
      { q: 'O que alguém vê ao escanear meu QR?', a: 'A ficha pública mostra informação útil em uma emergência, como tipo sanguíneo, alergias, condições relevantes, medicação e o contato principal. Exames e dados privados exigem o PIN para o modo consulta.' },
      { q: 'Posso me cadastrar sem usar o WhatsApp?', a: 'Sim. O assistente de cadastro funciona neste site. Para receber códigos de acesso e mensagens automáticas por WhatsApp, o bot precisa estar conectado ao serviço.' },
      { q: 'Posso levar meus documentos?', a: 'Sim. Do seu passaporte você pode baixar um arquivo com seu histórico e documentos. O arquivo é protegido com seu PIN e exige um aplicativo compatível com ZIP AES-256 para abrir.' },
      { q: 'Como funcionam os lembretes e as consultas?', a: 'Você pode criar avisos de medicação e consultas pessoais. Se houver médicos ativos no catálogo, o assistente também pode mostrar horários livres para reservar; uma consulta com custo é confirmada quando o pagamento é creditado.' },
      { q: 'O que acontece se minha assinatura vencer?', a: 'O sistema envia avisos de renovação. Após o período de espera configurado, o QR pode ficar inativo até regularizar o pagamento; os dados permanecem guardados conforme o fluxo vigente do serviço.' },
    ],
    ctaKicker: 'COMECE HOJE', ctaH2a: 'Sua saúde tem uma história.\n', ctaH2em: 'Leve-a com você.', ctaP: 'Prepare seu passaporte médico em uma conversa simples.',
    ctaBtn: 'Criar meu Bio-Pass', ctaAlsoA: 'Você também pode ', ctaAlsoLink: 'entrar', ctaAlsoB: ' se já tem conta.',
    ftTagline: 'Seu passaporte médico inteligente. Informação essencial quando importa, ferramentas úteis todos os dias.',
    ftExplore: 'Explore', ftAccount: 'Sua conta', ftCreate: 'Criar Bio-Pass', ftTerms: 'Termos e condições', ftContact: 'Contato',
    ftCoverage: 'Paraguai · Brasil · EUA', ftRights: 'Todos os direitos reservados.', ftMade: 'Feito para cuidar do que importa.',
    waLabel: 'Dúvidas? Fale conosco 💬',
  },
  en: {
    waText: 'Hi, I would like more information about Bio-Pass',
    announce: 'Your health, organized for the moments that matter.', announceCta: 'See how it works',
    nav: ['The solution', 'How it works', 'Assistant', 'Plans', 'FAQ'],
    login: 'Log in', myPass: 'My passport', createCta: 'Create my Bio-Pass',
    heroEyebrow: 'YOUR HEALTH, ALWAYS WITH YOU', heroTitle: ['Your health story,', 'ready when', 'it matters most'],
    heroP: 'A smart medical passport that gathers the essentials of your health and keeps them within reach whenever you need to share them. From an emergency QR to your studies, reminders and appointments.',
    heroExplore: 'Explore the solution', heroMini: 'Private access with PIN · QR ready to share · Control of your data',
    heroBottomL: '01 / A NEW WAY TO CARE FOR YOURSELF', heroBottomR: 'SCROLL TO DISCOVER', heroMark: 'CARING MEANS BEING PREPARED',
    floatTopA: 'Your essential info', floatTopB: 'Always within reach', floatQrA: 'MEDICAL PASSPORT', floatQrB: 'One QR. One story.', floatQrC: 'Useful info instantly',
    trust: [
      { t: 'Emergency QR', s: 'Essential information available' },
      { t: 'Layered privacy', s: 'Private data protected with a PIN' },
      { t: 'Web and WhatsApp', s: 'Assistant on your everyday channels' },
      { t: 'Your history with you', s: 'Access and export from your account' },
    ],
    solKicker: 'THE SOLUTION', solH2a: 'Everything you need to\n', solH2em: 'care for your health, connected.',
    solP: 'Your information should not be scattered. Bio-Pass connects your medical profile, your documents and the tools that support you every day.',
    features: [
      { title: 'Emergency QR card', text: 'The essential data to assist the holder shows when the code is scanned, no login needed. Access is logged.' },
      { title: 'Personal medical vault', text: 'Health profile, studies, prescriptions, medication and emergency contacts gathered in one place.' },
      { title: 'Reminders that support you', text: 'Organize medication doses and appointments from the calendar or by chatting with the assistant.' },
      { title: 'Assistant on web and WhatsApp', text: 'Sign up and manage questions, documents and reminders through a guided conversation.' },
      { title: 'Appointments with professionals', text: 'Explore specialties and schedules from the available catalog; confirmed bookings notify both patient and doctor.' },
      { title: 'Your information, portable', text: 'Download a copy of your history and documents in a file protected with your PIN.' },
    ],
    emgKicker: 'READY FOR THE UNEXPECTED', emgH2a: 'When every second counts, ', emgH2em: 'the essentials are there.',
    emgP: 'Your QR opens an emergency card with the information you chose to register: blood type, allergies, conditions, medication and main contact. A professional can see the rest with your PIN.',
    emgList: ['Public access to the essential card', 'Private studies and data in PIN consultation mode', 'Scan logging and alerts when channels are active'],
    emgLink: 'Prepare my passport', emgCaption: 'A simple gesture. Information that helps.',
    stepsKicker: 'SIMPLE FROM THE FIRST STEP', stepsH2a: 'This is how ', stepsH2em: 'Bio-Pass works.', stepsP: 'An experience designed to keep your information organized and easy to use.',
    steps: [
      { title: 'Create your account', text: 'Start in the web assistant with your phone number and complete your profile step by step.' },
      { title: 'Build your passport', text: 'Add your medical data, contacts, studies, medications and reminders.' },
      { title: 'Carry your QR', text: 'Share it from your phone or download the kit to print it as a sticker.' },
      { title: 'Stay in control', text: 'Review your access logs, protect private data with a PIN and export your data.' },
    ],
    asKicker: 'YOUR HEALTH ASSISTANT', asH2a: 'Your health gets organized by ', asH2em: 'chatting too.',
    asP: 'The web assistant guides sign-up and helps manage your information. The WhatsApp bot supports questions, documents, medications, appointments and alerts when the channel is connected.',
    asPoints: ['Guided chat', 'Audio and voice as available', 'Assisted document reading'], asBtn: 'Talk to the assistant',
    asChatName: 'Bio-Pass Assistant', asChatSub: 'A conversation at your pace', asMsg1: 'Hi 👋 How can I help you today?', asMsg2: 'I want to organize my medications and my next appointment.', asMsg3: 'Great. We can set up your reminders step by step.',
    asOpts: ['💊 Medication', '📅 Appointments', '📄 Studies'], asInput: 'Type your message...', asDisc: 'Illustrative view of the assistant',
    ecoKicker: 'AN ECOSYSTEM FOR YOUR EVERYDAY', ecoH2a: 'More than a card.\n', ecoH2em: 'A space to care for yourself.',
    ecoP: 'Tools connected to your passport to organize what matters and share it when you decide.',
    ecoMainT: 'Studies and prescriptions, in one place.', ecoMainP: 'Upload documents to your vault, review them when you need to and find your medical information faster.',
    ecoTags: ['Medical studies', 'Prescriptions and documents', 'Health profile'],
    ecoSmall1T: 'Appointments with doctors', ecoSmall1P: 'Search professionals in the catalog, pick a free slot and track your appointments from the assistant.', ecoSmall1Tag: 'Connected schedule',
    ecoSmall2T: 'Useful reminders', ecoSmall2P: 'Plan medications and appointments. Alerts are sent through the channels you have active.', ecoSmall2Tag: 'At your pace',
    ctrlKicker: 'YOUR DATA, YOUR DECISION', ctrlH2a: 'Designed to give you ', ctrlH2em: 'more control.',
    ctrlP: 'The public card is limited to what helps in an emergency. The most sensitive history opens with a PIN; files are delivered via temporary links and you can download a copy of your information.',
    ctrlLink: 'Get started with Bio-Pass', ctrlSeeAccess: 'See my access logs',
    ctrl: [
      { t: 'Private access with PIN', p: 'Separation between rescue card and consultation mode.' },
      { t: 'Scan traceability', p: 'Review access logs recorded in your account.' },
      { t: 'History export', p: 'Your protected copy, ready to download.' },
      { t: 'Scan location', p: 'Approximate by IP, or precise if the browser shares it.' },
    ],
    priKicker: 'PLANS AND ACCESS', priH2a: 'A plan to keep ', priH2em: 'caring for yourself.', priP: 'Choose your country to see the current service prices.',
    regions: { paraguay: 'Paraguay', brasil: 'Brazil', usa: 'USA / USD' },
    planFlex: 'FLEXIBLE', planMonthly: 'Monthly', planMonthlyP: 'Your passport and tools, month by month.', perMonth: ' / month',
    planMonthlyFeat: ['QR and emergency card', 'Vault and documents', 'Assistant and reminders'], startNow: 'Start now',
    twoMonths: 'TWO MONTHS INCLUDED', annualPlan: 'ANNUAL PLAN', moreCont: 'MORE CONTINUITY', planAnnual: 'Annual',
    planAnnual2m: 'Twelve months of Bio-Pass for the price of ten.', planAnnual1: 'One payment for the whole year.', perYear: ' / year',
    planAnnualFeat2m: 'Savings versus twelve payments', planAnnualFeat1: 'Twelve-month validity', chooseAnnual: 'Choose the annual plan',
    consult: 'See price', priNote: 'Available payment methods are confirmed when the order is generated. Prices may be updated from the administration.',
    faqKicker: 'FREQUENTLY ASKED QUESTIONS', faqH2a: 'Answers to start ', faqH2em: 'with confidence.', faqP: 'If you need help, our team can guide you by email.', faqContact: 'Contact support',
    faqs: [
      { q: 'What does someone who scans my QR see?', a: 'The public card shows information useful in an emergency, such as blood type, allergies, relevant conditions, medication and the main contact. Studies and private data require the PIN for consultation mode.' },
      { q: 'Can I sign up without using WhatsApp?', a: 'Yes. The sign-up assistant works on this website. To receive access codes and automatic messages via WhatsApp, the bot must be connected to the service.' },
      { q: 'Can I take my documents with me?', a: 'Yes. From your passport you can download a file with your history and documents. The file is protected with your PIN and requires an app compatible with ZIP AES-256 to open it.' },
      { q: 'How do reminders and appointments work?', a: 'You can create medication alerts and personal appointments. If there are active doctors in the catalog, the assistant can also show free slots to book; a paid consultation is confirmed once the payment is credited.' },
      { q: 'What happens if my subscription expires?', a: 'The system sends renewal alerts. After the configured grace period, the QR may become inactive until payment is settled; data remains stored according to the current service flow.' },
    ],
    ctaKicker: 'START TODAY', ctaH2a: 'Your health has a story.\n', ctaH2em: 'Take it with you.', ctaP: 'Set up your medical passport in a simple conversation.',
    ctaBtn: 'Create my Bio-Pass', ctaAlsoA: 'You can also ', ctaAlsoLink: 'log in', ctaAlsoB: ' if you already have an account.',
    ftTagline: 'Your smart medical passport. Essential information when it matters, useful tools every day.',
    ftExplore: 'Explore', ftAccount: 'Your account', ftCreate: 'Create Bio-Pass', ftTerms: 'Terms and conditions', ftContact: 'Contact',
    ftCoverage: 'Paraguay · Brazil · USA', ftRights: 'All rights reserved.', ftMade: 'Made to care for what matters.',
    waLabel: 'Questions? Chat with us 💬',
  },
};

const regionFlags: Record<Region, string> = { paraguay: '🇵🇾', brasil: '🇧🇷', usa: '🇺🇸' };

/** Renderiza un texto con "\n" como saltos de línea (<br/>). */
function nl2br(s: string) {
  return s.split('\n').flatMap((part, i) => (i === 0 ? [part] : [<br key={i} />, part]));
}

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem('biopass_lang');
    if (saved === 'es' || saved === 'pt' || saved === 'en') return saved;
  } catch { /* ignore */ }
  const nav = (navigator.language || '').toLowerCase();
  if (nav.startsWith('pt')) return 'pt';
  if (nav.startsWith('en')) return 'en';
  return 'es';
}

export function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [region, setRegion] = useState<Region>('paraguay');
  const [prices, setPrices] = useState<Prices | null>(null);
  const [waNumber, setWaNumber] = useState('595986338888'); // número del bot conectado (fallback)
  const [lang, setLang] = useState<Lang>(initialLang);
  const hasSession = Boolean(localStorage.getItem('biopass_token'));
  const t = T[lang];

  useEffect(() => {
    let mounted = true;
    api.get('/payments/methods')
      .then(({ data }) => { if (mounted) setPrices(data as Prices); })
      .catch(() => { /* Show plans without stale prices if the service is unavailable. */ });
    api.get('/bot/public-info')
      .then(({ data }) => { if (mounted && data?.botNumber) setWaNumber(String(data.botNumber)); })
      .catch(() => { /* usa el fallback */ });
    return () => { mounted = false; };
  }, []);

  const changeLang = (l: Lang) => {
    setLang(l);
    try { localStorage.setItem('biopass_lang', l); } catch { /* ignore */ }
    try { document.documentElement.lang = l; } catch { /* ignore */ }
  };
  useEffect(() => { try { document.documentElement.lang = lang; } catch { /* ignore */ } }, [lang]);

  const waHref = `https://wa.me/${waNumber.replace(/\D/g, '')}?text=${encodeURIComponent(t.waText)}`;
  const closeMenu = () => setMenuOpen(false);
  const selectedPrice = prices?.[region];
  const twoMonthsIncluded = Boolean(selectedPrice && Math.abs(selectedPrice.plans.annual.amount - selectedPrice.plans.monthly.amount * 10) < 0.001);

  const featureMeta = [
    { icon: QrCode, color: 'mint' }, { icon: FileHeart, color: 'sky' }, { icon: BellRing, color: 'peach' },
    { icon: MessageCircle, color: 'lilac' }, { icon: CalendarDays, color: 'mint' }, { icon: Download, color: 'sky' },
  ];
  const stepIcons = [MessageCircle, ClipboardPlus, QrCode, ShieldCheck];

  const LangSwitcher = (
    <div className="bp-lang" role="group" aria-label="Idioma / Language">
      {LANGS.map((l) => (
        <button key={l.id} type="button" className={lang === l.id ? 'active' : ''} aria-pressed={lang === l.id} title={l.label} onClick={() => changeLang(l.id)}>
          <span aria-hidden="true">{l.flag}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="landing" id="inicio">
      <div className="landing-announcement">
        <span className="landing-announcement-dot" />
        {t.announce}
        <a href="#como-funciona">{t.announceCta} <ArrowRight size={13} /></a>
      </div>

      <header className="landing-header">
        <div className="landing-container landing-header-inner">
          <a className="landing-brand" href="#inicio" onClick={closeMenu} aria-label="Bio-Pass">
            <span className="landing-brand-icon"><HeartPulse size={22} strokeWidth={2.5} /></span>
            <span className="landing-brand-word">bio<span>pass</span><small>HEALTH PASSPORT</small></span>
          </a>
          <nav className={`landing-nav${menuOpen ? ' is-open' : ''}`} aria-label="Navegación principal">
            <a href="#solucion" onClick={closeMenu}>{t.nav[0]}</a>
            <a href="#como-funciona" onClick={closeMenu}>{t.nav[1]}</a>
            <a href="#asistente" onClick={closeMenu}>{t.nav[2]}</a>
            <a href="#planes" onClick={closeMenu}>{t.nav[3]}</a>
            <a href="#preguntas" onClick={closeMenu}>{t.nav[4]}</a>
            <div className="landing-nav-lang">{LangSwitcher}</div>
          </nav>
          <div className="landing-header-actions">
            {LangSwitcher}
            <Link className="landing-login" to={hasSession ? '/dashboard' : '/login'}>{hasSession ? t.myPass : t.login}</Link>
            <Link className="landing-button landing-button-small" to="/registro">{t.createCta} <ArrowRight size={16} /></Link>
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
              <div className="landing-eyebrow"><span className="landing-eyebrow-line" /> {t.heroEyebrow}</div>
              <h1 id="landing-title">{t.heroTitle[0]}<br /><em>{t.heroTitle[1]}</em><br />{t.heroTitle[2]}<span className="landing-dot">.</span></h1>
              <p>{t.heroP}</p>
              <div className="landing-hero-actions">
                <Link className="landing-button landing-button-primary" to="/registro">{t.createCta} <ArrowRight size={19} /></Link>
                <a className="landing-text-link" href="#solucion">{t.heroExplore} <ArrowDown size={16} /></a>
              </div>
              <div className="landing-hero-mini"><span className="landing-mini-icon"><ShieldCheck size={17} /></span><span>{t.heroMini}</span></div>
            </div>
            <div className="landing-hero-visual">
              <div className="landing-photo-frame"><img src="/landing/hero-care.jpg" alt="Bio-Pass" loading="eager" /></div>
              <div className="landing-float-card landing-float-top"><span className="landing-float-icon"><HeartPulse size={19} /></span><span><strong>{t.floatTopA}</strong><small>{t.floatTopB}</small></span><Check size={15} className="landing-float-check" /></div>
              <div className="landing-float-card landing-float-bottom"><span className="landing-float-qr"><QrCode size={34} strokeWidth={1.6} /></span><span><small>{t.floatQrA}</small><strong>{t.floatQrB}</strong><small>{t.floatQrC}</small></span></div>
              <div className="landing-visual-mark">{t.heroMark} <span>✳</span></div>
            </div>
          </div>
          <div className="landing-container landing-hero-bottom"><span>{t.heroBottomL}</span><span>{t.heroBottomR} <ArrowDown size={14} /></span></div>
        </section>

        <section className="landing-trust" aria-label="Aspectos principales">
          <div className="landing-container landing-trust-grid">
            {[QrCode, LockKeyhole, Smartphone, Globe2].map((Icon, i) => (
              <div key={i}><Icon size={23} /><span><strong>{t.trust[i].t}</strong><small>{t.trust[i].s}</small></span></div>
            ))}
          </div>
        </section>

        <section className="landing-section landing-features" id="solucion">
          <div className="landing-container">
            <div className="landing-section-head">
              <div><span className="landing-kicker">{t.solKicker}</span><h2>{nl2br(t.solH2a)}<em>{t.solH2em}</em></h2></div>
              <p>{t.solP}</p>
            </div>
            <div className="landing-feature-grid">
              {t.features.map((f, i) => {
                const Icon = featureMeta[i].icon;
                return (
                  <article className={`landing-feature-card landing-feature-${featureMeta[i].color}`} key={i}>
                    <div className="landing-feature-card-top"><span className="landing-feature-icon"><Icon size={27} strokeWidth={1.7} /></span><span className="landing-feature-index">{String(i + 1).padStart(2, '0')} / 06</span></div>
                    <div><h3>{f.title}</h3><p>{f.text}</p></div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="landing-section landing-emergency" id="emergencia">
          <div className="landing-container landing-emergency-grid">
            <div className="landing-emergency-visual"><img src="/landing/qr-care.jpg" alt="QR" loading="lazy" /><span className="landing-image-caption"><span className="landing-caption-dot" /> {t.emgCaption}</span></div>
            <div className="landing-emergency-copy"><span className="landing-kicker">{t.emgKicker}</span><h2>{t.emgH2a}<em>{t.emgH2em}</em></h2><p>{t.emgP}</p>
              <ul className="landing-check-list">{t.emgList.map((x, i) => <li key={i}><Check size={16} /> {x}</li>)}</ul>
              <Link className="landing-inline-link" to="/registro">{t.emgLink} <ArrowRight size={17} /></Link>
            </div>
          </div>
        </section>

        <section className="landing-section landing-steps" id="como-funciona">
          <div className="landing-container">
            <div className="landing-center-head"><span className="landing-kicker">{t.stepsKicker}</span><h2>{t.stepsH2a}<em>{t.stepsH2em}</em></h2><p>{t.stepsP}</p></div>
            <div className="landing-step-grid">{t.steps.map((s, i) => { const Icon = stepIcons[i]; return <article key={i} className="landing-step"><span className="landing-step-number">{String(i + 1).padStart(2, '0')}</span><span className="landing-step-icon"><Icon size={24} /></span><h3>{s.title}</h3><p>{s.text}</p></article>; })}</div>
          </div>
        </section>

        <section className="landing-section landing-assistant" id="asistente">
          <div className="landing-container landing-assistant-grid">
            <div className="landing-assistant-copy"><span className="landing-kicker landing-kicker-light">{t.asKicker}</span><h2>{t.asH2a}<em>{t.asH2em}</em></h2><p>{t.asP}</p><div className="landing-assistant-points"><span><Bot size={18} /> {t.asPoints[0]}</span><span><AudioLines size={18} /> {t.asPoints[1]}</span><span><Sparkles size={18} /> {t.asPoints[2]}</span></div><Link className="landing-button landing-button-light" to="/registro">{t.asBtn} <ArrowRight size={18} /></Link></div>
            <div className="landing-chat-scene" aria-label="Asistente"><div className="landing-chat-orb"><AudioLines size={31} /></div><div className="landing-chat-card"><div className="landing-chat-head"><span className="landing-chat-avatar"><HeartPulse size={20} /></span><span><strong>{t.asChatName}</strong><small>{t.asChatSub}</small></span><span className="landing-online-dot" /></div><div className="landing-chat-body"><div className="landing-chat-message bot-message">{t.asMsg1}</div><div className="landing-chat-message user-message">{t.asMsg2}</div><div className="landing-chat-message bot-message">{t.asMsg3}</div><div className="landing-chat-options">{t.asOpts.map((o, i) => <span key={i}>{o}</span>)}</div></div><div className="landing-chat-input">{t.asInput} <span><ArrowRight size={15} /></span></div></div><span className="landing-chat-disclaimer">{t.asDisc}</span></div>
          </div>
        </section>

        <section className="landing-section landing-ecosystem">
          <div className="landing-container"><div className="landing-section-head"><div><span className="landing-kicker">{t.ecoKicker}</span><h2>{nl2br(t.ecoH2a)}<em>{t.ecoH2em}</em></h2></div><p>{t.ecoP}</p></div><div className="landing-ecosystem-grid"><article className="landing-ecosystem-main"><div className="landing-ecosystem-icon"><FileText size={28} /></div><h3>{t.ecoMainT}</h3><p>{t.ecoMainP}</p><div className="landing-doc-stack"><span><FileHeart size={19} /> {t.ecoTags[0]} <Check size={15} /></span><span><FileText size={19} /> {t.ecoTags[1]} <Check size={15} /></span><span><Activity size={19} /> {t.ecoTags[2]} <Check size={15} /></span></div></article><article className="landing-ecosystem-small"><div className="landing-ecosystem-icon"><Stethoscope size={27} /></div><h3>{t.ecoSmall1T}</h3><p>{t.ecoSmall1P}</p><div className="landing-small-tag"><CalendarDays size={15} /> {t.ecoSmall1Tag}</div></article><article className="landing-ecosystem-small"><div className="landing-ecosystem-icon"><BellRing size={27} /></div><h3>{t.ecoSmall2T}</h3><p>{t.ecoSmall2P}</p><div className="landing-small-tag"><BellRing size={15} /> {t.ecoSmall2Tag}</div></article></div></div>
        </section>

        <section className="landing-section landing-control"><div className="landing-container landing-control-grid"><div><span className="landing-kicker">{t.ctrlKicker}</span><h2>{t.ctrlH2a}<em>{t.ctrlH2em}</em></h2><p>{t.ctrlP}</p><Link className="landing-inline-link" to={hasSession ? '/audit-logs' : '/registro'}>{hasSession ? t.ctrlSeeAccess : t.ctrlLink} <ArrowRight size={17} /></Link></div><div className="landing-control-list">{[LockKeyhole, ScanLine, Download, MapPin].map((Icon, i) => <div key={i}><span><Icon size={21} /></span><strong>{t.ctrl[i].t}</strong><p>{t.ctrl[i].p}</p></div>)}</div></div></section>

        <section className="landing-section landing-pricing" id="planes"><div className="landing-container"><div className="landing-center-head"><span className="landing-kicker">{t.priKicker}</span><h2>{t.priH2a}<em>{t.priH2em}</em></h2><p>{t.priP}</p></div><div className="landing-region-tabs" role="group" aria-label="País">{(['paraguay', 'brasil', 'usa'] as Region[]).map((id) => <button key={id} type="button" className={region === id ? 'active' : ''} onClick={() => setRegion(id)} aria-pressed={region === id}><span>{regionFlags[id]}</span> {t.regions[id]}</button>)}</div><div className="landing-plan-grid"><article className="landing-plan-card"><span className="landing-plan-type">{t.planFlex}</span><h3>{t.planMonthly}</h3><p>{t.planMonthlyP}</p><div className="landing-plan-price">{selectedPrice?.plans.monthly.formatted ?? t.consult}{selectedPrice && <small>{t.perMonth}</small>}</div><ul>{t.planMonthlyFeat.map((x, i) => <li key={i}><Check size={16} /> {x}</li>)}</ul><Link to="/registro">{t.startNow} <ArrowRight size={16} /></Link></article><article className="landing-plan-card landing-plan-featured"><span className="landing-plan-badge">{twoMonthsIncluded ? t.twoMonths : t.annualPlan}</span><span className="landing-plan-type">{t.moreCont}</span><h3>{t.planAnnual}</h3><p>{twoMonthsIncluded ? t.planAnnual2m : t.planAnnual1}</p><div className="landing-plan-price">{selectedPrice?.plans.annual.formatted ?? t.consult}{selectedPrice && <small>{t.perYear}</small>}</div><ul><li><Check size={16} /> {t.planMonthlyFeat[0]}</li><li><Check size={16} /> {t.planAnnual1}</li><li><Check size={16} /> {twoMonthsIncluded ? t.planAnnualFeat2m : t.planAnnualFeat1}</li></ul><Link to="/registro">{t.chooseAnnual} <ArrowRight size={16} /></Link></article></div><p className="landing-pricing-note"><CreditCard size={15} /> {t.priNote}</p></div></section>

        <section className="landing-section landing-faq" id="preguntas"><div className="landing-container landing-faq-grid"><div><span className="landing-kicker">{t.faqKicker}</span><h2>{t.faqH2a}<em>{t.faqH2em}</em></h2><p>{t.faqP}</p><a href={supportMailto('Bio-Pass')} className="landing-inline-link">{t.faqContact} <ArrowRight size={17} /></a></div><div className="landing-faq-list">{t.faqs.map(({ q, a }) => <details key={q}><summary>{q}<ChevronDown size={19} /></summary><p>{a}</p></details>)}</div></div></section>

        <section className="landing-final-cta"><div className="landing-container landing-final-inner"><div><span className="landing-kicker landing-kicker-light">{t.ctaKicker}</span><h2>{nl2br(t.ctaH2a)}<em>{t.ctaH2em}</em></h2><p>{t.ctaP}</p></div><div><Link className="landing-button landing-button-white" to="/registro">{t.ctaBtn} <ArrowRight size={19} /></Link><span>{t.ctaAlsoA}<Link to="/login">{t.ctaAlsoLink}</Link>{t.ctaAlsoB}</span></div></div></section>
      </main>

      <footer className="landing-footer"><div className="landing-container"><div className="landing-footer-main"><div><a className="landing-brand" href="#inicio"><span className="landing-brand-icon"><HeartPulse size={21} /></span><span className="landing-brand-word">bio<span>pass</span><small>HEALTH PASSPORT</small></span></a><p>{t.ftTagline}</p></div><div><strong>{t.ftExplore}</strong><a href="#solucion">{t.nav[0]}</a><a href="#como-funciona">{t.nav[1]}</a><a href="#asistente">{t.nav[2]}</a><a href="#planes">{t.nav[3]}</a></div><div><strong>{t.ftAccount}</strong><Link to="/registro">{t.ftCreate}</Link><Link to="/login">{t.login}</Link><a href={`${API_BASE_URL}/legal/terminos`} target="_blank" rel="noreferrer">{t.ftTerms}</a></div><div><strong>{t.ftContact}</strong><a href={supportMailto()}>{SUPPORT_EMAIL}</a><span>{t.ftCoverage}</span></div></div><div className="landing-footer-bottom"><span>© {new Date().getFullYear()} Doorway Cortex Bio-Pass. {t.ftRights}</span><span>{t.ftMade} <HeartPulse size={14} /></span></div></div></footer>

      {/* Botón flotante de WhatsApp → abre el chat con el número conectado del bot. */}
      <a className="bp-wa-fab" href={waHref} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp">
        <span className="bp-wa-label">{t.waLabel}</span>
        <span className="bp-wa-btn">
          <span className="bp-wa-pulse" aria-hidden="true" />
          <svg viewBox="0 0 32 32" aria-hidden="true" fill="currentColor">
            <path d="M16.04 4C9.9 4 4.92 8.98 4.92 15.12c0 2.14.6 4.14 1.64 5.85L4.5 28l7.2-1.9a11.07 11.07 0 0 0 4.34.87h.01c6.14 0 11.12-4.98 11.12-11.12C27.17 8.98 22.18 4 16.04 4zm0 20.3h-.01c-1.36 0-2.69-.37-3.85-1.06l-.28-.16-4.27 1.12 1.14-4.16-.18-.29a9.2 9.2 0 0 1-1.41-4.9c0-5.08 4.14-9.22 9.23-9.22 2.46 0 4.78.96 6.52 2.7a9.17 9.17 0 0 1 2.7 6.52c0 5.09-4.14 9.21-9.22 9.21zm5.06-6.9c-.28-.14-1.64-.81-1.9-.9-.25-.09-.44-.14-.62.14-.18.28-.71.9-.87 1.08-.16.18-.32.2-.6.07-.28-.14-1.17-.43-2.23-1.38-.82-.73-1.38-1.64-1.54-1.92-.16-.28-.02-.43.12-.57.13-.13.28-.32.42-.49.14-.16.18-.28.28-.46.09-.18.05-.35-.02-.49-.07-.14-.62-1.5-.85-2.05-.22-.53-.45-.46-.62-.47l-.53-.01c-.18 0-.46.07-.71.35-.25.28-.95.93-.95 2.27 0 1.34.97 2.63 1.1 2.81.14.18 1.92 2.93 4.65 4.11.65.28 1.16.45 1.56.58.65.21 1.25.18 1.72.11.52-.08 1.64-.67 1.87-1.32.23-.65.23-1.2.16-1.32-.07-.12-.25-.19-.53-.33z" />
          </svg>
        </span>
      </a>
      <style>{`
        .bp-lang{display:inline-flex;gap:2px;background:rgba(0,0,0,.05);border-radius:999px;padding:3px}
        .bp-lang button{border:0;background:transparent;cursor:pointer;font-size:17px;line-height:1;width:30px;height:28px;border-radius:999px;display:grid;place-items:center;opacity:.5;transition:all .15s;padding:0}
        .bp-lang button:hover{opacity:.85}
        .bp-lang button.active{opacity:1;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.14)}
        .landing-nav-lang{display:none}
        @media(max-width:860px){.landing-header-actions .bp-lang{display:none}.landing-nav-lang{display:block;margin-top:6px}}
        .bp-wa-fab{position:fixed;right:22px;bottom:22px;z-index:60;display:flex;align-items:center;gap:10px;text-decoration:none}
        .bp-wa-btn{position:relative;width:62px;height:62px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(145deg,#25D366,#128C7E);box-shadow:0 12px 28px rgba(18,140,126,.45);color:#fff;transition:transform .2s}
        .bp-wa-fab:hover .bp-wa-btn{transform:scale(1.07)}
        .bp-wa-btn svg{width:34px;height:34px;position:relative;z-index:1}
        .bp-wa-pulse{position:absolute;inset:0;border-radius:50%;background:#25D366;opacity:.55;animation:bp-wa-ping 2s ease-out infinite}
        .bp-wa-label{background:#fff;color:#0b4a3f;font-weight:800;font-size:13px;padding:9px 14px;border-radius:999px;box-shadow:0 10px 22px rgba(0,0,0,.14);white-space:nowrap;animation:bp-wa-rise .4s ease}
        @keyframes bp-wa-ping{0%{transform:scale(1);opacity:.55}100%{transform:scale(1.95);opacity:0}}
        @keyframes bp-wa-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
        @media(max-width:640px){.bp-wa-label{display:none}.bp-wa-fab{right:16px;bottom:16px}}
      `}</style>
    </div>
  );
}
