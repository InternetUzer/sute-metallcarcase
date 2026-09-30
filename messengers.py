"""Public messenger destinations editable by the site owner."""
import re


def phone_number(value):
    if not re.fullmatch(r'[+\d\s()-]{7,40}', value, re.ASCII):
        raise ValueError('Укажите номер WhatsApp в международном формате, например +7 (905) 443-32-59.')
    digits = re.sub(r'\D', '', value)
    if len(digits) == 11 and digits.startswith('8'):
        digits = '7' + digits[1:]
    if not re.fullmatch(r'[1-9][0-9]{6,14}', digits):
        raise ValueError('Проверьте международный номер WhatsApp.')
    return digits


def profile_url(value, kind):
    patterns = {
        'telegram': r'https://t\.me/(?:[A-Za-z0-9_]{3,64}|\+[1-9][0-9]{6,14})/?',
        'max_url': r'https://max\.ru/(?:u/)?[A-Za-z0-9_-]+/?',
    }
    if value and (len(value) > 1000 or not re.fullmatch(patterns[kind], value)):
        name, host = ('Telegram', 't.me') if kind == 'telegram' else ('MAX', 'max.ru')
        raise ValueError(f'Укажите ссылку на профиль {name}: https://{host}/… или оставьте поле пустым.')
    return value


def validate_settings(form):
    result = {key: profile_url(form.get(key, '').strip(), key) for key in ('telegram', 'max_url')}
    phone = form.get('whatsapp_phone', '').strip()
    result['whatsapp_phone'] = phone_number(phone) if phone else ''
    result['whatsapp_enabled'] = '1' if form.get('whatsapp_enabled') == '1' else '0'
    return result


def public_links(company):
    links = []
    for key, name, code in [('max_url', 'MAX', 'max'), ('telegram', 'Telegram', 'telegram')]:
        try:
            url = profile_url(company.get(key, ''), key)
        except ValueError:
            continue
        if url:
            links.append(dict(name=name, code=code, url=url))
    if company.get('whatsapp_enabled', '1') == '1':
        try:
            phone = phone_number(company.get('whatsapp_phone') or company['phone'])
        except ValueError:
            pass
        else:
            links.append(dict(name='WhatsApp', code='whatsapp', url='https://wa.me/' + phone))
    return links
