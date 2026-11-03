// Библиотека шаблонов работ «Состава объекта» — копия assets/work-templates/v2.json приложения (TECHNADZOR).
// Не править вручную: при новой редакции библиотеки в приложении скопировать файл заново (docs/PRORAB.md).
(function (root) {
  const data = {
   "library": "prorab-work-templates",
   "version": 2,
   "units": {
    "m3": "м³",
    "m2": "м²",
    "t": "т",
    "pcs": "шт.",
    "m": "п.м."
   },
   "categories": [
    {
     "key": "earth",
     "title": "Земля",
     "workType": "Земляные работы"
    },
    {
     "key": "metal",
     "title": "Металл",
     "workType": "Металлоконструкции"
    },
    {
     "key": "concrete",
     "title": "Бетон и ЖБ",
     "workType": "Бетонные работы"
    },
    {
     "key": "roof",
     "title": "Кровля",
     "workType": "Кровля"
    },
    {
     "key": "walls",
     "title": "Стены",
     "workType": "Стены и фасады"
    },
    {
     "key": "waterproofing",
     "title": "Гидроизоляция",
     "workType": "Гидроизоляция"
    }
   ],
   "nodeKinds": [
    {
     "key": "site",
     "category": "earth",
     "title": "Площадка: планировка",
     "group": "Площадка",
     "hint": "Расчистка, планировка территории"
    },
    {
     "key": "pit",
     "category": "earth",
     "title": "Котлован",
     "group": "Выемки",
     "hint": "Разработка, погрузка, вывоз"
    },
    {
     "key": "trench",
     "category": "earth",
     "title": "Траншея",
     "group": "Выемки",
     "hint": "Под ленточный фундамент или сети"
    },
    {
     "key": "backfill",
     "category": "earth",
     "title": "Обратная засыпка",
     "group": "Засыпка и основания",
     "hint": "Пазухи котлована, траншей"
    },
    {
     "key": "base_sand",
     "category": "earth",
     "title": "Песчаное основание",
     "group": "Засыпка и основания",
     "hint": "Укладка слоями и уплотнение"
    },
    {
     "key": "base_gravel",
     "category": "earth",
     "title": "Щебёночное основание",
     "group": "Засыпка и основания",
     "hint": "Укладка слоями и уплотнение"
    },
    {
     "key": "steel_frame",
     "category": "metal",
     "title": "Металлокаркас",
     "group": "Каркас целиком",
     "hint": "Колонны, балки, фермы, связи — одной позицией"
    },
    {
     "key": "steel_columns",
     "category": "metal",
     "title": "Колонны металлические",
     "group": "Отдельные элементы"
    },
    {
     "key": "steel_beams",
     "category": "metal",
     "title": "Балки металлические",
     "group": "Отдельные элементы"
    },
    {
     "key": "steel_trusses",
     "category": "metal",
     "title": "Фермы",
     "group": "Отдельные элементы"
    },
    {
     "key": "steel_bracing",
     "category": "metal",
     "title": "Связи",
     "group": "Отдельные элементы"
    },
    {
     "key": "steel_purlins",
     "category": "metal",
     "title": "Прогоны",
     "group": "Отдельные элементы"
    },
    {
     "key": "steel_stairs",
     "category": "metal",
     "title": "Лестницы и площадки",
     "group": "Лестницы"
    },
    {
     "key": "foundation_monolith",
     "category": "concrete",
     "title": "Отдельный монолитный фундамент",
     "group": "Фундаменты — монолит",
     "hint": "Под колонну: Ф1, Ф2… Гидроизоляцию добавьте отдельно: раздел «Гидроизоляция»"
    },
    {
     "key": "foundation_block_monolith",
     "category": "concrete",
     "title": "Монолитные фундаментные блоки",
     "group": "Фундаменты — монолит",
     "hint": "Отдельные заливаемые элементы. Гидроизоляцию добавьте отдельно: раздел «Гидроизоляция»"
    },
    {
     "key": "foundation_strip",
     "category": "concrete",
     "title": "Ленточный фундамент",
     "group": "Фундаменты — монолит",
     "hint": "Гидроизоляцию добавьте отдельно: раздел «Гидроизоляция»"
    },
    {
     "key": "foundation_slab",
     "category": "concrete",
     "title": "Фундаментная плита",
     "group": "Фундаменты — монолит",
     "hint": "Гидроизоляцию добавьте отдельно: раздел «Гидроизоляция»"
    },
    {
     "key": "foundation_blocks",
     "category": "concrete",
     "title": "Сборные фундаментные блоки (ФБС)",
     "group": "Фундаменты — сборные",
     "hint": "Монтаж блоков, не монолит. Гидроизоляцию добавьте отдельно: раздел «Гидроизоляция»"
    },
    {
     "key": "floor_slab",
     "category": "concrete",
     "title": "Плита пола по грунту",
     "group": "Плиты"
    },
    {
     "key": "slab_monolith",
     "category": "concrete",
     "title": "Монолитная плита перекрытия / покрытия",
     "group": "Плиты"
    },
    {
     "key": "slab_precast",
     "category": "concrete",
     "title": "Сборные плиты перекрытия",
     "group": "Плиты"
    },
    {
     "key": "column_monolith",
     "category": "concrete",
     "title": "Монолитные колонны",
     "group": "Колонны, балки, ригели"
    },
    {
     "key": "column_precast",
     "category": "concrete",
     "title": "Сборные ЖБ колонны",
     "group": "Колонны, балки, ригели"
    },
    {
     "key": "beam_monolith",
     "category": "concrete",
     "title": "Монолитные балки и ригели",
     "group": "Колонны, балки, ригели"
    },
    {
     "key": "beam_precast",
     "category": "concrete",
     "title": "Сборные балки и ригели",
     "group": "Колонны, балки, ригели"
    },
    {
     "key": "wall_monolith",
     "category": "concrete",
     "title": "Монолитные стены",
     "group": "Стены и лестницы"
    },
    {
     "key": "wall_precast",
     "category": "concrete",
     "title": "Сборные ЖБ стеновые панели",
     "group": "Стены и лестницы"
    },
    {
     "key": "stairs_monolith",
     "category": "concrete",
     "title": "Монолитные лестницы",
     "group": "Стены и лестницы"
    },
    {
     "key": "stairs_precast",
     "category": "concrete",
     "title": "Сборные лестничные марши и площадки",
     "group": "Стены и лестницы"
    },
    {
     "key": "roof_metal",
     "category": "roof",
     "title": "Кровля: профлист / металлочерепица",
     "group": "Покрытие"
    },
    {
     "key": "roof_sandwich",
     "category": "roof",
     "title": "Кровля: сэндвич-панели",
     "group": "Покрытие"
    },
    {
     "key": "roof_membrane",
     "category": "roof",
     "title": "Кровля: мембранная (по профнастилу)",
     "group": "Покрытие"
    },
    {
     "key": "roof_rolled",
     "category": "roof",
     "title": "Кровля: рулонная (наплавляемая)",
     "group": "Покрытие"
    },
    {
     "key": "drainage",
     "category": "roof",
     "title": "Водосток",
     "group": "Водосток"
    },
    {
     "key": "wall_sandwich",
     "category": "walls",
     "title": "Стены: сэндвич-панели",
     "group": "Ограждение"
    },
    {
     "key": "wall_profiled",
     "category": "walls",
     "title": "Стены: профлист",
     "group": "Ограждение"
    },
    {
     "key": "wall_layered",
     "category": "walls",
     "title": "Стены: послойное ограждение",
     "group": "Ограждение",
     "hint": "Подсистема, утеплитель, мембрана, обшивка"
    },
    {
     "key": "wp_coating",
     "category": "waterproofing",
     "title": "Обмазочная (мастика)",
     "group": "Система",
     "hint": "Место — фундамент, плита, стена: укажите в поле «Место»"
    },
    {
     "key": "wp_rolled",
     "category": "waterproofing",
     "title": "Оклеечная (рулонная)",
     "group": "Система",
     "hint": "Место — фундамент, плита, стена: укажите в поле «Место»"
    },
    {
     "key": "wp_membrane",
     "category": "waterproofing",
     "title": "Мембранная",
     "group": "Система",
     "hint": "Место — фундамент, плита, стена: укажите в поле «Место»"
    }
   ],
   "templates": [
    {
     "key": "earth.site.clearing",
     "revision": 1,
     "category": "earth",
     "nodeKinds": [
      "site"
     ],
     "title": "Расчистка площадки",
     "unitCode": "m2",
     "suggested": true
    },
    {
     "key": "earth.site.grading",
     "revision": 1,
     "category": "earth",
     "nodeKinds": [
      "site"
     ],
     "title": "Планировка площадки",
     "unitCode": "m2",
     "suggested": true
    },
    {
     "key": "earth.excavation",
     "revision": 1,
     "category": "earth",
     "nodeKinds": [
      "pit",
      "trench"
     ],
     "title": "Разработка грунта",
     "unitCode": "m3",
     "suggested": true
    },
    {
     "key": "earth.manual_excavation",
     "revision": 1,
     "category": "earth",
     "nodeKinds": [
      "pit",
      "trench"
     ],
     "title": "Доработка грунта вручную",
     "unitCode": "m3"
    },
    {
     "key": "earth.loading",
     "revision": 1,
     "category": "earth",
     "nodeKinds": [
      "site",
      "pit",
      "trench"
     ],
     "title": "Погрузка грунта",
     "unitCode": "m3"
    },
    {
     "key": "earth.removal",
     "revision": 1,
     "category": "earth",
     "nodeKinds": [
      "site",
      "pit",
      "trench"
     ],
     "title": "Вывоз грунта",
     "unitCode": "m3"
    },
    {
     "key": "earth.sand_bed",
     "revision": 1,
     "category": "earth",
     "nodeKinds": [
      "site",
      "pit",
      "trench"
     ],
     "title": "Песчаная подушка",
     "unitCode": "m3",
     "retired": true
    },
    {
     "key": "earth.base.delivery",
     "revision": 1,
     "category": "earth",
     "nodeKinds": [
      "base_sand",
      "base_gravel",
      "backfill"
     ],
     "title": "Доставка материала (песок, щебень, грунт)",
     "unitCode": "m3"
    },
    {
     "key": "earth.base.placing",
     "revision": 1,
     "category": "earth",
     "nodeKinds": [
      "base_sand",
      "base_gravel"
     ],
     "title": "Укладка основания слоями",
     "unitCode": "m3",
     "suggested": true
    },
    {
     "key": "earth.base.compaction",
     "revision": 1,
     "category": "earth",
     "nodeKinds": [
      "base_sand",
      "base_gravel"
     ],
     "title": "Уплотнение основания",
     "unitCode": "m2",
     "suggested": true
    },
    {
     "key": "earth.backfill",
     "revision": 2,
     "category": "earth",
     "nodeKinds": [
      "pit",
      "trench",
      "backfill",
      "foundation_monolith",
      "foundation_block_monolith",
      "foundation_strip",
      "foundation_slab",
      "foundation_blocks",
      "floor_slab"
     ],
     "title": "Обратная засыпка",
     "unitCode": "m3",
     "suggested": true
    },
    {
     "key": "earth.compaction",
     "revision": 2,
     "category": "earth",
     "nodeKinds": [
      "site",
      "pit",
      "trench",
      "backfill"
     ],
     "title": "Уплотнение грунта",
     "unitCode": "m2"
    },
    {
     "key": "steel.frame.combined",
     "revision": 1,
     "category": "metal",
     "nodeKinds": [
      "steel_frame"
     ],
     "title": "Изготовление и монтаж каркаса (комплекс)",
     "unitCode": "t",
     "alternativeGroup": "steel.frame.fabrication-erection",
     "variantMode": "COMBINED"
    },
    {
     "key": "steel.frame.fabrication",
     "revision": 1,
     "category": "metal",
     "nodeKinds": [
      "steel_frame"
     ],
     "title": "Изготовление металлоконструкций",
     "unitCode": "t",
     "alternativeGroup": "steel.frame.fabrication-erection",
     "variantMode": "SEPARATE"
    },
    {
     "key": "steel.frame.installation",
     "revision": 1,
     "category": "metal",
     "nodeKinds": [
      "steel_frame"
     ],
     "title": "Монтаж металлоконструкций",
     "unitCode": "t",
     "alternativeGroup": "steel.frame.fabrication-erection",
     "variantMode": "SEPARATE"
    },
    {
     "key": "steel.elements.combined",
     "revision": 1,
     "category": "metal",
     "nodeKinds": [
      "steel_columns",
      "steel_beams",
      "steel_trusses",
      "steel_bracing",
      "steel_purlins"
     ],
     "title": "Изготовление и монтаж (комплекс)",
     "unitCode": "t",
     "alternativeGroup": "steel.elements.fabrication-erection",
     "variantMode": "COMBINED"
    },
    {
     "key": "steel.elements.fabrication",
     "revision": 1,
     "category": "metal",
     "nodeKinds": [
      "steel_columns",
      "steel_beams",
      "steel_trusses",
      "steel_bracing",
      "steel_purlins"
     ],
     "title": "Изготовление",
     "unitCode": "t",
     "alternativeGroup": "steel.elements.fabrication-erection",
     "variantMode": "SEPARATE"
    },
    {
     "key": "steel.elements.installation",
     "revision": 1,
     "category": "metal",
     "nodeKinds": [
      "steel_columns",
      "steel_beams",
      "steel_trusses",
      "steel_bracing",
      "steel_purlins"
     ],
     "title": "Монтаж",
     "unitCode": "t",
     "alternativeGroup": "steel.elements.fabrication-erection",
     "variantMode": "SEPARATE"
    },
    {
     "key": "steel.anchor_bolts",
     "revision": 2,
     "category": "metal",
     "nodeKinds": [
      "steel_frame",
      "steel_columns"
     ],
     "title": "Монтаж анкерных болтов",
     "unitCode": "pcs"
    },
    {
     "key": "steel.surface_prep",
     "revision": 1,
     "category": "metal",
     "nodeKinds": [
      "steel_frame",
      "steel_columns",
      "steel_beams",
      "steel_trusses",
      "steel_bracing",
      "steel_purlins",
      "steel_stairs"
     ],
     "title": "Подготовка поверхности (очистка, обезжиривание)",
     "unitCode": "m2"
    },
    {
     "key": "steel.anticorrosion",
     "revision": 2,
     "category": "metal",
     "nodeKinds": [
      "steel_frame",
      "steel_columns",
      "steel_beams",
      "steel_trusses",
      "steel_bracing",
      "steel_purlins",
      "steel_stairs"
     ],
     "title": "Антикоррозионное покрытие",
     "unitCode": "m2"
    },
    {
     "key": "steel.fireproofing",
     "revision": 2,
     "category": "metal",
     "nodeKinds": [
      "steel_frame",
      "steel_columns",
      "steel_beams",
      "steel_trusses",
      "steel_bracing",
      "steel_purlins"
     ],
     "title": "Огнезащита",
     "unitCode": "m2"
    },
    {
     "key": "steel.stairs.combined",
     "revision": 1,
     "category": "metal",
     "nodeKinds": [
      "steel_stairs"
     ],
     "title": "Изготовление и монтаж лестниц и площадок (комплекс)",
     "unitCode": "t",
     "alternativeGroup": "steel.stairs.fabrication-erection",
     "variantMode": "COMBINED"
    },
    {
     "key": "steel.stairs.fabrication",
     "revision": 1,
     "category": "metal",
     "nodeKinds": [
      "steel_stairs"
     ],
     "title": "Изготовление лестниц и площадок",
     "unitCode": "t",
     "alternativeGroup": "steel.stairs.fabrication-erection",
     "variantMode": "SEPARATE"
    },
    {
     "key": "steel.stairs.installation",
     "revision": 1,
     "category": "metal",
     "nodeKinds": [
      "steel_stairs"
     ],
     "title": "Монтаж лестниц и площадок",
     "unitCode": "t",
     "alternativeGroup": "steel.stairs.fabrication-erection",
     "variantMode": "SEPARATE"
    },
    {
     "key": "steel.railings",
     "revision": 1,
     "category": "metal",
     "nodeKinds": [
      "steel_stairs"
     ],
     "title": "Монтаж ограждений",
     "unitCode": "m"
    },
    {
     "key": "concrete.base_prep",
     "revision": 1,
     "category": "concrete",
     "nodeKinds": [
      "foundation_monolith",
      "foundation_block_monolith",
      "foundation_strip",
      "foundation_slab",
      "foundation_blocks",
      "floor_slab"
     ],
     "title": "Подготовка основания",
     "unitCode": "m2"
    },
    {
     "key": "concrete.sand_layer",
     "revision": 1,
     "category": "concrete",
     "nodeKinds": [
      "foundation_monolith",
      "foundation_block_monolith",
      "foundation_strip",
      "foundation_slab",
      "foundation_blocks",
      "floor_slab"
     ],
     "title": "Песчаная подготовка",
     "unitCode": "m3"
    },
    {
     "key": "concrete.gravel_layer",
     "revision": 1,
     "category": "concrete",
     "nodeKinds": [
      "foundation_monolith",
      "foundation_block_monolith",
      "foundation_strip",
      "foundation_slab",
      "foundation_blocks",
      "floor_slab"
     ],
     "title": "Щебёночная подготовка",
     "unitCode": "m3"
    },
    {
     "key": "concrete.preparation",
     "revision": 2,
     "category": "concrete",
     "nodeKinds": [
      "foundation_monolith",
      "foundation_block_monolith",
      "foundation_strip",
      "foundation_slab",
      "floor_slab"
     ],
     "title": "Бетонная подготовка (подбетонка)",
     "unitCode": "m3",
     "suggested": true
    },
    {
     "key": "concrete.formwork",
     "revision": 2,
     "category": "concrete",
     "nodeKinds": [
      "foundation_monolith",
      "foundation_block_monolith",
      "foundation_strip",
      "foundation_slab",
      "floor_slab",
      "slab_monolith",
      "column_monolith",
      "beam_monolith",
      "wall_monolith",
      "stairs_monolith"
     ],
     "title": "Опалубка",
     "unitCode": "m2",
     "suggested": true
    },
    {
     "key": "concrete.reinforcement",
     "revision": 2,
     "category": "concrete",
     "nodeKinds": [
      "foundation_monolith",
      "foundation_block_monolith",
      "foundation_strip",
      "foundation_slab",
      "floor_slab",
      "slab_monolith",
      "column_monolith",
      "beam_monolith",
      "wall_monolith",
      "stairs_monolith"
     ],
     "title": "Армирование",
     "unitCode": "t",
     "suggested": true
    },
    {
     "key": "concrete.embedded_parts",
     "revision": 2,
     "category": "concrete",
     "nodeKinds": [
      "foundation_monolith",
      "foundation_block_monolith",
      "foundation_strip",
      "foundation_slab",
      "slab_monolith",
      "column_monolith",
      "beam_monolith",
      "wall_monolith"
     ],
     "title": "Закладные детали",
     "unitCode": "pcs",
     "suggested": true
    },
    {
     "key": "concrete.anchor_groups",
     "revision": 2,
     "category": "concrete",
     "nodeKinds": [
      "foundation_monolith",
      "foundation_block_monolith"
     ],
     "title": "Анкерные группы",
     "unitCode": "pcs",
     "suggested": true
    },
    {
     "key": "concrete.pouring",
     "revision": 2,
     "category": "concrete",
     "nodeKinds": [
      "foundation_monolith",
      "foundation_block_monolith",
      "foundation_strip",
      "foundation_slab",
      "floor_slab",
      "slab_monolith",
      "column_monolith",
      "beam_monolith",
      "wall_monolith",
      "stairs_monolith"
     ],
     "title": "Бетонирование",
     "unitCode": "m3",
     "suggested": true
    },
    {
     "key": "concrete.curing",
     "revision": 1,
     "category": "concrete",
     "nodeKinds": [
      "foundation_monolith",
      "foundation_block_monolith",
      "foundation_strip",
      "foundation_slab",
      "floor_slab",
      "slab_monolith",
      "column_monolith",
      "beam_monolith",
      "wall_monolith",
      "stairs_monolith"
     ],
     "title": "Уход за бетоном",
     "unitCode": "m2",
     "suggested": true
    },
    {
     "key": "concrete.formwork_removal",
     "revision": 1,
     "category": "concrete",
     "nodeKinds": [
      "foundation_monolith",
      "foundation_block_monolith",
      "foundation_strip",
      "foundation_slab",
      "floor_slab",
      "slab_monolith",
      "column_monolith",
      "beam_monolith",
      "wall_monolith",
      "stairs_monolith"
     ],
     "title": "Распалубка",
     "unitCode": "m2",
     "suggested": true
    },
    {
     "key": "concrete.insulation",
     "revision": 1,
     "category": "concrete",
     "nodeKinds": [
      "foundation_strip",
      "foundation_slab",
      "floor_slab",
      "wall_monolith",
      "wall_precast"
     ],
     "title": "Утепление",
     "unitCode": "m2"
    },
    {
     "key": "concrete.waterproofing",
     "revision": 1,
     "category": "concrete",
     "nodeKinds": [
      "foundation_monolith",
      "foundation_blocks",
      "foundation_slab"
     ],
     "title": "Гидроизоляция",
     "unitCode": "m2",
     "retired": true
    },
    {
     "key": "concrete.floor.topping",
     "revision": 1,
     "category": "concrete",
     "nodeKinds": [
      "floor_slab"
     ],
     "title": "Упрочнение поверхности (топпинг)",
     "unitCode": "m2"
    },
    {
     "key": "concrete.floor.joints",
     "revision": 1,
     "category": "concrete",
     "nodeKinds": [
      "floor_slab"
     ],
     "title": "Нарезка деформационных швов",
     "unitCode": "m"
    },
    {
     "key": "concrete.blocks.installation",
     "revision": 1,
     "category": "concrete",
     "nodeKinds": [
      "foundation_blocks"
     ],
     "title": "Монтаж фундаментных блоков",
     "unitCode": "pcs",
     "suggested": true
    },
    {
     "key": "concrete.blocks.belt",
     "revision": 1,
     "category": "concrete",
     "nodeKinds": [
      "foundation_blocks"
     ],
     "title": "Армопояс по блокам",
     "unitCode": "m3"
    },
    {
     "key": "concrete.precast.installation",
     "revision": 1,
     "category": "concrete",
     "nodeKinds": [
      "slab_precast",
      "column_precast",
      "beam_precast",
      "wall_precast",
      "stairs_precast"
     ],
     "title": "Монтаж сборных элементов",
     "unitCode": "pcs",
     "suggested": true
    },
    {
     "key": "concrete.precast.temporary",
     "revision": 1,
     "category": "concrete",
     "nodeKinds": [
      "column_precast",
      "beam_precast",
      "wall_precast"
     ],
     "title": "Временное закрепление",
     "unitCode": "pcs",
     "suggested": true
    },
    {
     "key": "concrete.precast.alignment",
     "revision": 1,
     "category": "concrete",
     "nodeKinds": [
      "foundation_blocks",
      "slab_precast",
      "column_precast",
      "beam_precast",
      "wall_precast",
      "stairs_precast"
     ],
     "title": "Выверка",
     "unitCode": "pcs",
     "suggested": true
    },
    {
     "key": "concrete.precast.connections",
     "revision": 1,
     "category": "concrete",
     "nodeKinds": [
      "foundation_blocks",
      "slab_precast",
      "column_precast",
      "beam_precast",
      "wall_precast",
      "stairs_precast"
     ],
     "title": "Устройство соединений (сварка закладных, узлы)",
     "unitCode": "pcs",
     "suggested": true
    },
    {
     "key": "concrete.precast.joints",
     "revision": 1,
     "category": "concrete",
     "nodeKinds": [
      "foundation_blocks",
      "slab_precast",
      "column_precast",
      "beam_precast",
      "wall_precast",
      "stairs_precast"
     ],
     "title": "Замоноличивание стыков",
     "unitCode": "m",
     "suggested": true
    },
    {
     "key": "roof.battens",
     "revision": 1,
     "category": "roof",
     "nodeKinds": [
      "roof_metal"
     ],
     "title": "Обрешётка",
     "unitCode": "m2",
     "suggested": true
    },
    {
     "key": "roof.substructure",
     "revision": 1,
     "category": "roof",
     "nodeKinds": [
      "roof_sandwich"
     ],
     "title": "Подсистема (прогоны, опорные элементы)",
     "unitCode": "m2",
     "suggested": true
    },
    {
     "key": "roof.deck",
     "revision": 2,
     "category": "roof",
     "nodeKinds": [
      "roof_membrane",
      "roof_rolled"
     ],
     "title": "Несущий профнастил",
     "unitCode": "m2",
     "suggested": true
    },
    {
     "key": "roof.vapor_barrier",
     "revision": 2,
     "category": "roof",
     "nodeKinds": [
      "roof_membrane",
      "roof_rolled",
      "roof_metal"
     ],
     "title": "Пароизоляция",
     "unitCode": "m2",
     "suggested": true
    },
    {
     "key": "roof.insulation",
     "revision": 2,
     "category": "roof",
     "nodeKinds": [
      "roof_membrane",
      "roof_rolled",
      "roof_metal"
     ],
     "title": "Утепление",
     "unitCode": "m2",
     "suggested": true
    },
    {
     "key": "roof.waterproofing_film",
     "revision": 1,
     "category": "roof",
     "nodeKinds": [
      "roof_metal"
     ],
     "title": "Гидро-ветрозащитная плёнка",
     "unitCode": "m2",
     "suggested": true
    },
    {
     "key": "roof.slope_layer",
     "revision": 2,
     "category": "roof",
     "nodeKinds": [
      "roof_membrane",
      "roof_rolled"
     ],
     "title": "Уклонообразующий слой",
     "unitCode": "m2"
    },
    {
     "key": "roof.screed",
     "revision": 1,
     "category": "roof",
     "nodeKinds": [
      "roof_rolled"
     ],
     "title": "Основание (стяжка, плиты) под рулонную кровлю",
     "unitCode": "m2"
    },
    {
     "key": "roof.primer",
     "revision": 1,
     "category": "roof",
     "nodeKinds": [
      "roof_rolled"
     ],
     "title": "Грунтование основания праймером",
     "unitCode": "m2",
     "suggested": true
    },
    {
     "key": "roof.rolled",
     "revision": 1,
     "category": "roof",
     "nodeKinds": [
      "roof_rolled"
     ],
     "title": "Наплавляемая кровля (по слоям)",
     "unitCode": "m2",
     "suggested": true
    },
    {
     "key": "roof.membrane",
     "revision": 1,
     "category": "roof",
     "nodeKinds": [
      "roof_membrane"
     ],
     "title": "Мембрана ПВХ",
     "unitCode": "m2",
     "suggested": true
    },
    {
     "key": "roof.sandwich_panels",
     "revision": 1,
     "category": "roof",
     "nodeKinds": [
      "roof_sandwich"
     ],
     "title": "Монтаж кровельных сэндвич-панелей",
     "unitCode": "m2",
     "suggested": true
    },
    {
     "key": "roof.metal_covering",
     "revision": 1,
     "category": "roof",
     "nodeKinds": [
      "roof_metal"
     ],
     "title": "Покрытие из профлиста / металлочерепицы",
     "unitCode": "m2",
     "suggested": true
    },
    {
     "key": "roof.fasteners",
     "revision": 1,
     "category": "roof",
     "nodeKinds": [
      "roof_sandwich",
      "roof_metal",
      "roof_membrane"
     ],
     "title": "Крепёж покрытия и панелей",
     "unitCode": "pcs"
    },
    {
     "key": "roof.joint_sealing",
     "revision": 1,
     "category": "roof",
     "nodeKinds": [
      "roof_metal",
      "roof_sandwich",
      "roof_membrane",
      "roof_rolled"
     ],
     "title": "Герметизация стыков",
     "unitCode": "m"
    },
    {
     "key": "roof.flashings",
     "revision": 2,
     "category": "roof",
     "nodeKinds": [
      "roof_metal",
      "roof_sandwich",
      "roof_membrane",
      "roof_rolled"
     ],
     "title": "Доборные элементы и примыкания",
     "unitCode": "m"
    },
    {
     "key": "roof.ridge",
     "revision": 1,
     "category": "roof",
     "nodeKinds": [
      "roof_sandwich",
      "roof_metal"
     ],
     "title": "Конёк",
     "unitCode": "m"
    },
    {
     "key": "roof.valleys",
     "revision": 1,
     "category": "roof",
     "nodeKinds": [
      "roof_metal",
      "roof_sandwich",
      "roof_membrane",
      "roof_rolled"
     ],
     "title": "Ендовы",
     "unitCode": "m"
    },
    {
     "key": "roof.eaves",
     "revision": 1,
     "category": "roof",
     "nodeKinds": [
      "roof_metal",
      "roof_sandwich",
      "roof_membrane",
      "roof_rolled"
     ],
     "title": "Карнизы и свесы",
     "unitCode": "m"
    },
    {
     "key": "roof.drainage.gutters",
     "revision": 1,
     "category": "roof",
     "nodeKinds": [
      "drainage"
     ],
     "title": "Водосточные желоба",
     "unitCode": "m",
     "suggested": true
    },
    {
     "key": "roof.drainage.pipes",
     "revision": 1,
     "category": "roof",
     "nodeKinds": [
      "drainage"
     ],
     "title": "Водосточные трубы",
     "unitCode": "m",
     "suggested": true
    },
    {
     "key": "roof.drainage.funnels",
     "revision": 1,
     "category": "roof",
     "nodeKinds": [
      "drainage"
     ],
     "title": "Водосточные воронки",
     "unitCode": "pcs"
    },
    {
     "key": "walls.substructure",
     "revision": 1,
     "category": "walls",
     "nodeKinds": [
      "wall_sandwich",
      "wall_profiled",
      "wall_layered"
     ],
     "title": "Каркас / подсистема (ригели, фахверк)",
     "unitCode": "m2"
    },
    {
     "key": "walls.vapor_barrier",
     "revision": 1,
     "category": "walls",
     "nodeKinds": [
      "wall_layered"
     ],
     "title": "Пароизоляция",
     "unitCode": "m2",
     "suggested": true
    },
    {
     "key": "walls.insulation",
     "revision": 1,
     "category": "walls",
     "nodeKinds": [
      "wall_layered"
     ],
     "title": "Утепление",
     "unitCode": "m2",
     "suggested": true
    },
    {
     "key": "walls.wind_barrier",
     "revision": 1,
     "category": "walls",
     "nodeKinds": [
      "wall_layered"
     ],
     "title": "Ветро-влагозащитная мембрана",
     "unitCode": "m2",
     "suggested": true
    },
    {
     "key": "walls.sandwich_panels",
     "revision": 1,
     "category": "walls",
     "nodeKinds": [
      "wall_sandwich"
     ],
     "title": "Монтаж стеновых сэндвич-панелей",
     "unitCode": "m2",
     "suggested": true
    },
    {
     "key": "walls.profiled",
     "revision": 1,
     "category": "walls",
     "nodeKinds": [
      "wall_profiled",
      "wall_layered"
     ],
     "title": "Обшивка профлистом",
     "unitCode": "m2",
     "suggested": true
    },
    {
     "key": "walls.fasteners",
     "revision": 1,
     "category": "walls",
     "nodeKinds": [
      "wall_sandwich",
      "wall_profiled",
      "wall_layered"
     ],
     "title": "Крепёж панелей и листов",
     "unitCode": "pcs"
    },
    {
     "key": "walls.joint_sealing",
     "revision": 1,
     "category": "walls",
     "nodeKinds": [
      "wall_sandwich",
      "wall_profiled",
      "wall_layered"
     ],
     "title": "Герметизация стыков",
     "unitCode": "m"
    },
    {
     "key": "walls.flashings",
     "revision": 1,
     "category": "walls",
     "nodeKinds": [
      "wall_sandwich",
      "wall_profiled",
      "wall_layered"
     ],
     "title": "Доборные элементы и примыкания",
     "unitCode": "m"
    },
    {
     "key": "walls.corners",
     "revision": 1,
     "category": "walls",
     "nodeKinds": [
      "wall_sandwich",
      "wall_profiled",
      "wall_layered"
     ],
     "title": "Угловые элементы",
     "unitCode": "m"
    },
    {
     "key": "walls.base_flashing",
     "revision": 1,
     "category": "walls",
     "nodeKinds": [
      "wall_sandwich",
      "wall_profiled",
      "wall_layered"
     ],
     "title": "Цокольное обрамление (отлив)",
     "unitCode": "m"
    },
    {
     "key": "walls.opening_trims",
     "revision": 1,
     "category": "walls",
     "nodeKinds": [
      "wall_sandwich",
      "wall_profiled",
      "wall_layered"
     ],
     "title": "Обрамление проёмов (окна, двери, ворота)",
     "unitCode": "m"
    },
    {
     "key": "wp.cleaning",
     "revision": 1,
     "category": "waterproofing",
     "nodeKinds": [
      "wp_coating",
      "wp_rolled",
      "wp_membrane"
     ],
     "title": "Очистка и подготовка поверхности",
     "unitCode": "m2",
     "suggested": true
    },
    {
     "key": "wp.repair",
     "revision": 1,
     "category": "waterproofing",
     "nodeKinds": [
      "wp_coating",
      "wp_rolled",
      "wp_membrane"
     ],
     "title": "Ремонт и выравнивание основания",
     "unitCode": "m2"
    },
    {
     "key": "wp.fillets",
     "revision": 1,
     "category": "waterproofing",
     "nodeKinds": [
      "wp_coating",
      "wp_rolled"
     ],
     "title": "Устройство галтелей",
     "unitCode": "m"
    },
    {
     "key": "wp.primer",
     "revision": 1,
     "category": "waterproofing",
     "nodeKinds": [
      "wp_coating",
      "wp_rolled"
     ],
     "title": "Грунтование праймером",
     "unitCode": "m2",
     "suggested": true
    },
    {
     "key": "wp.mastic",
     "revision": 1,
     "category": "waterproofing",
     "nodeKinds": [
      "wp_coating"
     ],
     "title": "Нанесение мастики / обмазочной изоляции",
     "unitCode": "m2",
     "suggested": true
    },
    {
     "key": "wp.rolled",
     "revision": 1,
     "category": "waterproofing",
     "nodeKinds": [
      "wp_rolled"
     ],
     "title": "Укладка рулонной изоляции",
     "unitCode": "m2",
     "suggested": true
    },
    {
     "key": "wp.membrane",
     "revision": 1,
     "category": "waterproofing",
     "nodeKinds": [
      "wp_membrane"
     ],
     "title": "Укладка мембраны",
     "unitCode": "m2",
     "suggested": true
    },
    {
     "key": "wp.joints",
     "revision": 1,
     "category": "waterproofing",
     "nodeKinds": [
      "wp_coating",
      "wp_rolled",
      "wp_membrane"
     ],
     "title": "Обработка швов и примыканий",
     "unitCode": "m",
     "suggested": true
    },
    {
     "key": "wp.protection",
     "revision": 1,
     "category": "waterproofing",
     "nodeKinds": [
      "wp_coating",
      "wp_rolled",
      "wp_membrane"
     ],
     "title": "Защитный слой (профилированная мембрана, ЭППС, стяжка)",
     "unitCode": "m2"
    }
   ]
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = data;
  else root.PRORAB_WORK_TEMPLATES = data;
})(typeof window !== 'undefined' ? window : globalThis);
