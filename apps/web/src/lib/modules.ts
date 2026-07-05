/** Catálogo de módulos (doc Cowinance_Catalogo_Modulos): 11 suites · 40 módulos. */
export interface ModuleInfo {
  name: string;
  suite: string;
  fase: string;
  description: string;
}

export const MODULES: Record<string, ModuleInfo> = {
  lotes: {
    name: 'Lotes y rodeos',
    suite: 'B · Ganadería',
    fase: 'Fase 1',
    description: 'Gestión de lotes/rodeos y movimientos entre potreros, lotes y fincas con trazabilidad de ubicación.',
  },
  mapa: {
    name: 'Potreros y Mapa',
    suite: 'D · Agricultura y tierra',
    fase: 'Fase 2',
    description: 'Cartografía propia sobre tiles vectoriales, dibujo de potreros, capas de agua, cercas, sensores y animales con GPS. Funciona offline.',
  },
  tareas: {
    name: 'Tareas y Calendario',
    suite: 'A · Núcleo',
    fase: 'Fase 1-2',
    description: 'Tareas de campo asignables, calendario sanitario y reproductivo con recordatorios automáticos.',
  },
  reproduccion: {
    name: 'Reproducción y genética',
    suite: 'B · Ganadería',
    fase: 'Fase 1',
    description: 'Celos, servicios (monta/IA/TE), diagnósticos de gestación, partos, destetes, protocolos IATF y banco genético.',
  },
  sanidad: {
    name: 'Sanidad y veterinaria',
    suite: 'B · Ganadería',
    fase: 'Fase 1',
    description: 'Vacunaciones y tratamientos con cálculo automático de retiros, historia clínica, planes sanitarios y mortalidad.',
  },
  produccion: {
    name: 'Producción y pesajes',
    suite: 'B · Ganadería',
    fase: 'Fase 1',
    description: 'Pesajes con báscula Bluetooth, GDP, curvas de crecimiento, condición corporal y captura masiva en manga.',
  },
  nutricion: {
    name: 'Nutrición y alimentación',
    suite: 'B · Ganadería',
    fase: 'Fase 2',
    description: 'Formulación de raciones, entregas de alimento, eficiencia de conversión y costo de alimentación por kg producido.',
  },
  inventario: {
    name: 'Inventarios',
    suite: 'E · Cadena de suministro',
    fase: 'Fase 2',
    description: 'Maestro de materiales, multi-depósito, lotes y vencimientos, kardex completo y puntos de reposición.',
  },
  maquinaria: {
    name: 'Maquinaria y activos',
    suite: 'E · Cadena de suministro',
    fase: 'Fase 2',
    description: 'Flota con horómetro y telemetría, mantenimiento preventivo, combustible y costo por hora de máquina.',
  },
  finanzas: {
    name: 'Finanzas y contabilidad',
    suite: 'G · Finanzas',
    fase: 'Fase 2',
    description: 'Partida doble multi-moneda, centros de costo hasta el nivel animal, tesorería, presupuestos y consolidación multiempresa.',
  },
  comercial: {
    name: 'Compras y Ventas',
    suite: 'F · Comercial y CRM',
    fase: 'Fase 2',
    description: 'Ciclo completo procure-to-pay y order-to-cash: órdenes, recepciones, liquidaciones de frigorífico y guías de movilización.',
  },
  marketplace: {
    name: 'Marketplace ganadero',
    suite: 'C · Sistemas productivos',
    fase: 'Fase 4',
    description: 'Comercialización P2P de animales, genética y servicios con trazabilidad verificable por blockchain como argumento de venta.',
  },
  reportes: {
    name: 'Reportes',
    suite: 'J · Datos e Inteligencia',
    fase: 'Fase 2',
    description: 'Reportes operativos y regulatorios reconstruibles por eventos, constructor con filtros y envío programado.',
  },
  alertas: {
    name: 'Notificaciones y alertas',
    suite: 'A · Núcleo',
    fase: 'Fase 1',
    description: 'Motor de reglas declarativas con entrega multicanal: push, email, SMS, WhatsApp e in-app.',
  },
  academia: {
    name: 'Academia y cursos',
    suite: 'K · Ecosistema',
    fase: 'Fase 3-4',
    description: 'Capacitación de productores y empleados dentro del producto, con contenido contextual y certificados.',
  },
  configuracion: {
    name: 'Configuración y catálogos',
    suite: 'A · Núcleo',
    fase: 'Fase 0-1',
    description: 'Catálogos maestros (razas, categorías, diagnósticos), parámetros de negocio y motor de reglas por tenant.',
  },
};
