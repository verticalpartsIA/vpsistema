// Mapeamento de imagens de fundo para cada card do dashboard
// Fotos: escadas/rolantes com estética industrial — tema VerticalParts

const IMAGES = [
  '/images/daniel-dalea-bKI9DEtOqg8-unsplash.jpg',    // 0 – escada rolante azul, noturna
  '/images/declan-sun-b4fUGkKLEcw-unsplash.jpg',      // 1 – escadas cruzadas, aço cinza
  '/images/escadas.jpg',                               // 2 – shopping, perspectiva ampla
  '/images/francisco-delgado-1RUNbHofhYQ-unsplash.jpg',// 3 – escada rolante moderna
  '/images/julien-andrieux-KnAH5pNJ58Y-unsplash.jpg', // 4 – escada ao céu aberto
  '/images/omar-prestwich-U6XW6BeKuyI-unsplash.jpg',  // 5 – escada rolante branca
  '/images/ricardo-gomez-angel-U_riwEM5piM-unsplash.jpg',// 6 – átrio com skylight dourado
  '/images/scott-stefan-x_MaD-3TU2c-unsplash.jpg',   // 7 – escadas cruzadas com neon
]

// Cards admin (fixos no topo do dashboard)
export const ADMIN_CARD_IMAGES = {
  administracao: IMAGES[2],   // shopping amplo — gestão
  painel:        IMAGES[6],   // átrio dourado — executivo
  logs:          IMAGES[0],   // azul noturno — histórico/log
}

// Módulos do banco — por slug
const MODULE_IMAGES = {
  catraca:            IMAGES[0],  // azul noturno → controle de acesso
  visitas:            IMAGES[4],  // céu aberto → visitas externas
  vpsuprimentos:      IMAGES[7],  // neon cruzado → suprimentos
  suprimentos:        IMAGES[7],  // idem
  'cotacao-fornecedor': IMAGES[5],// branca limpa → cotação
  'cotacao-importacao': IMAGES[3],// moderna → internacional
  click:              IMAGES[1],  // aço cinza → tarefas
  engenharia:         IMAGES[6],  // skylight → projetos
  demanda:            IMAGES[7],  // neon → demandas
  suporte:            IMAGES[0],  // azul → TI/suporte
  propostas:          IMAGES[3],  // moderna → comercial
}

// Fallback: retorna imagem por slug; se não mapeado, usa por índice rotativo
const slugList = Object.keys(MODULE_IMAGES)
export function getCardImage(slug, index = 0) {
  return MODULE_IMAGES[slug] ?? IMAGES[index % IMAGES.length]
}
