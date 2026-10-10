# Sonoff DIN Rail Card

Карточка Home Assistant для отображения и управления несколькими DIN-реле в одном ряду. Поддерживает сущности `switch` и `light`.

### Классический корпус

![Карточка с полным корпусом и контактами](preview-full.png)

### Компактный корпус

![Карточка с компактным корпусом](preview-compact.png)

## Возможности

- Компактный корпус без винтов или классический корпус.
- Названия, состояние и индикаторы каждого реле.
- Настраиваемые короткое, долгое и двойное нажатия для каждого реле.
- Автоматическая подгонка ряда по ширине, масштабирование и горизонтальная прокрутка.
- Визуальный редактор карточки в Home Assistant.

## Установка

1. Скачайте [архив последнего релиза](https://github.com/rbalaev/sonoff-din-rail-card/releases/latest) и скопируйте три файла — `sonoff-din-rail-card.js`, `sonoff-din-rail-card.svg`, `sonoff-din-rail-card-compact.svg` — в `/config/www/community/sonoff-din-rail-card/`.
2. Добавьте ресурс JavaScript-модуля в **Настройки → Панели управления → Ресурсы**:
   `/local/community/sonoff-din-rail-card/sonoff-din-rail-card.js?v=2.12`
3. Обновите страницу и добавьте **Sonoff DIN Rail Card** через редактор карточек.

## Пример YAML

```yaml
type: custom:sonoff-din-rail-card
title: Реле щита
design: compact
entities:
  - entity: switch.gate
    name: Ворота
    tap_action:
      action: toggle
    hold_action:
      action: more-info
  - entity: switch.pump
    name: Насос
```

`entities` — список реле; порядок в списке определяет порядок в карточке. Для каждого реле можно задать `name`, `tap_action`, `hold_action` и `double_tap_action`. Доступны стандартные действия Home Assistant: `toggle`, `more-info`, `navigate`, `url`, `perform-action`, `assist` и `none`.

`design: compact` выбирает корпус без винтов; `design: full` — классический вариант. `fit: true` подгоняет ряд по ширине карточки. Параметр `scale` задаёт масштаб от `0.25` до `1.5` (по умолчанию `1`).
