"""Optional, service-specific enquiry fields shared by the form and validation."""
from decimal import Decimal, InvalidOperation
import re


def number(key, label, maximum, unit=''):
    return dict(key=key, label=label, type='number', maximum=maximum, unit=unit)


def choice(key, label, options):
    return dict(key=key, label=label, type='select', options=options)


GROUPS = [
    dict(key='building', title='Здание', services=['building'], fields=[
        number('width', 'Ширина, м', 1000), number('length', 'Длина, м', 1000),
        number('height', 'Высота, м', 1000),
        choice('insulation', 'Утепление', ['Холодное здание', 'Утеплённое здание']),
        dict(key='purpose', label='Назначение здания', type='text')]),
    dict(key='metal', title='Металлоконструкции', services=['izgotovleniye-metallokonstruktsiy', 'montaj-konstruktsii'], fields=[
        number('metal_weight', 'Примерная масса, т', 100000),
        choice('metal_type', 'Тип конструкций', ['Каркас здания', 'Колонны, балки, фермы', 'Лестницы и площадки', 'Другое']),
        choice('metal_drawings', 'Чертежи', ['Есть КМ', 'Есть КМД', 'Есть эскиз', 'Нужна помощь с документацией'])]),
    dict(key='concrete', title='Бетонные и монолитные работы', services=['betonnye-raboty'], fields=[
        choice('concrete_type', 'Конструкция', ['Фундамент', 'Фундаментная плита', 'Стены и колонны', 'Перекрытия', 'Бетонные полы', 'Площадка', 'Другое']),
        number('concrete_volume', 'Примерный объём бетона, м³', 1000000),
        number('concrete_area', 'Площадь, м²', 10000000),
        choice('concrete_ready', 'Готовность площадки', ['Подготовлена', 'Требуется подготовка', 'Объект строится'])]),
    dict(key='panels', title='Сэндвич-панели', services=['montazh-sendvich-panelej'], fields=[
        choice('panels_type', 'Панели', ['Стеновые', 'Кровельные', 'Стеновые и кровельные']),
        number('panels_area', 'Площадь монтажа, м²', 10000000),
        number('panels_thickness', 'Толщина панели, мм', 500),
        choice('panels_supply', 'Материалы', ['Есть у заказчика', 'Нужна поставка'])]),
    dict(key='roof', title='Кровля', services=['krovelnye-raboty'], fields=[
        choice('roof_type', 'Покрытие', ['Мембранная кровля', 'Наплавляемая кровля', 'Кровельные сэндвич-панели', 'Нужна помощь с выбором']),
        number('roof_area', 'Площадь кровли, м²', 10000000),
        choice('roof_base', 'Основание', ['Профнастил', 'Бетон / железобетон', 'Другое']),
        choice('roof_insulation', 'Утепление кровли', ['Требуется', 'Уже выполнено', 'Не требуется'])]),
]


def parse_parameters(values, selected, groups=None):
    result, errors = {}, []
    for group in GROUPS if groups is None else groups:
        if not set(group['services']).intersection(selected):
            continue
        for field in group['fields']:
            value = values.get(field['key'], '').strip()
            if not value or value == 'Пока не знаю':
                continue
            if len(value) > 160:
                errors.append(field['label'] + ': не более 160 символов.')
                continue
            if field['type'] == 'number':
                try:
                    if not re.fullmatch(r'[0-9]+(?:[.,][0-9]+)?', value):
                        raise InvalidOperation
                    parsed = Decimal(value.replace(',', '.'))
                    if not parsed.is_finite() or not 0 < parsed <= field['maximum']:
                        raise InvalidOperation
                except InvalidOperation:
                    errors.append(f"{field['label']}: укажите число больше нуля и не больше {field['maximum']} или оставьте поле пустым.")
                    continue
                value = format(parsed, 'f')
            elif field['type'] == 'select' and value not in field['options']:
                errors.append(field['label'] + ': выберите вариант из списка.')
                continue
            result[field['key']] = value
    return result, errors


LABELS = {field['key']: field['label'] for group in GROUPS for field in group['fields']}
