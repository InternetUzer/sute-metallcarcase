"""Archive public page content and every discovered image from metalcarcase.ru.

Run with requests + beautifulsoup4 installed. No authenticated areas are crawled.
Original images are retained; UI renditions are generated separately.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit, unquote
import hashlib
import json
import re
import time
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://metalcarcase.ru/'
OUT = ROOT / 'static' / 'images' / 'original'
OUT.mkdir(parents=True, exist_ok=True)
ARCHIVE = ROOT / 'content' / 'source'
ARCHIVE.mkdir(parents=True, exist_ok=True)
EXT = re.compile(r'\.(?:jpe?g|png|webp|gif|svg|avif|ico|bmp)(?:[?#]|$)', re.I)
images, css_urls, seen, failures = {}, set(), {}, []

def fetch(url):
    last = None
    for attempt in range(3):
        try:
            response = requests.get(url, timeout=35, headers={'User-Agent': 'MetalCarcase-Migration/1.0'})
            response.raise_for_status()
            return response
        except requests.RequestException as error:
            last = error
            time.sleep(attempt + .25)
    raise last

def normalized(url, parent):
    absolute = urljoin(parent, url.replace('&amp;', '&'))
    p = urlsplit(absolute)
    if p.scheme not in ('http', 'https'):
        return None
    if p.hostname in ('metalcarcase.ru', 'www.metalcarcase.ru'):
        return urlunsplit(('https', 'metalcarcase.ru', p.path or '/', p.query, ''))
    return absolute.split('#')[0]

def add_image(value, parent, alt=''):
    url = normalized(value.strip(' \"\''), parent)
    if url and EXT.search(url) and urlsplit(url).hostname not in ('mc.yandex.ru',):
        entry = images.setdefault(url, {'source_url': url, 'pages': [], 'alt': alt})
        if parent not in entry['pages']:
            entry['pages'].append(parent)

queue = {BASE}
while queue:
    batch = sorted(queue - seen.keys())
    queue = set()
    if not batch:
        break
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(fetch, u): u for u in batch}
        for future in as_completed(futures):
            url = futures[future]
            try:
                response = future.result()
                response.encoding = response.apparent_encoding
                soup = BeautifulSoup(response.text, 'html.parser')
                article = soup.find('article') or soup.find('main') or soup.body
                seen[url] = {'url': url, 'title': soup.title.get_text(' ', strip=True) if soup.title else '',
                             'text': article.get_text('\n', strip=True) if article else '',
                             'headings': [n.get_text(' ', strip=True) for n in soup.find_all(['h1', 'h2', 'h3'])]}
                for tag in soup.find_all(True):
                    for attr in ('src', 'data-src', 'data-original', 'href', 'poster', 'content', 'data-bg'):
                        value = tag.get(attr)
                        if isinstance(value, str):
                            add_image(value, url, tag.get('alt', ''))
                    for attr in ('srcset', 'data-srcset'):
                        for part in tag.get(attr, '').split(','):
                            if part.strip():
                                add_image(part.strip().split()[0], url, tag.get('alt', ''))
                for value in re.findall(r'url\([\"\']?(.*?)[\"\']?\)', response.text):
                    add_image(value, url)
                # CSS and JS-generated gallery data can include image URLs directly.
                for value in re.findall(r'[\"\']([^\"\'<>\s]+\.(?:jpg|jpeg|png|webp|gif|svg)(?:\?[^\"\'<>\s]*)?)[\"\']', response.text, re.I):
                    add_image(value, url)
                for link in soup.select('link[rel="stylesheet"]'):
                    css_urls.add(normalized(link['href'], url))
                for a in soup.select('a[href]'):
                    target = normalized(a['href'], url)
                    if not target:
                        continue
                    p = urlsplit(target)
                    if p.hostname != 'metalcarcase.ru' or p.query or EXT.search(target):
                        continue
                    if any(p.path.startswith(x) for x in ('/regist', '/search', '/user', '/g/', '/t/', '/thumb/', '/d/', '/assets/')):
                        continue
                    if '.' in p.path.split('/')[-1]:
                        continue
                    if target not in seen:
                        queue.add(target)
                print('PAGE', url, flush=True)
            except Exception as error:
                seen[url] = {'url': url, 'error': str(error)}
                failures.append({'url': url, 'error': str(error)})
    if len(seen) > 150:
        raise RuntimeError('Unexpectedly large crawl; inspect links before continuing')

with ThreadPoolExecutor(max_workers=6) as pool:
    futures = {pool.submit(fetch, u): u for u in css_urls if u}
    for future in as_completed(futures):
        url = futures[future]
        try:
            for value in re.findall(r'url\([\"\']?(.*?)[\"\']?\)', future.result().text):
                add_image(value, url)
        except Exception as error:
            failures.append({'url': url, 'error': str(error)})

def save_image(item):
    url, meta = item
    response = fetch(url)
    if not response.headers.get('content-type', '').startswith('image/'):
        raise ValueError('Not an image response')
    name = unquote(urlsplit(url).path.split('/')[-1])
    name = re.sub(r'[^A-Za-z0-9._-]', '-', name)[-100:] or 'image.jpg'
    filename = hashlib.sha256(url.encode()).hexdigest()[:12] + '-' + name
    target = OUT / filename
    target.write_bytes(response.content)
    meta.update(path=str(target.relative_to(ROOT)), bytes=len(response.content), sha256=hashlib.sha256(response.content).hexdigest())
    return meta

results = []
with ThreadPoolExecutor(max_workers=8) as pool:
    futures = {pool.submit(save_image, item): item[0] for item in images.items()}
    for future in as_completed(futures):
        try:
            results.append(future.result())
        except Exception as error:
            failures.append({'url': futures[future], 'error': str(error)})
(ARCHIVE / 'pages.json').write_text(json.dumps(sorted(seen.values(), key=lambda v:v['url']), ensure_ascii=False, indent=2))
(ARCHIVE / 'images.json').write_text(json.dumps(sorted(results, key=lambda v:v['source_url']), ensure_ascii=False, indent=2))
(ARCHIVE / 'import-report.json').write_text(json.dumps({'source':BASE, 'pages':len(seen), 'images':len(results), 'failures':failures}, ensure_ascii=False, indent=2))
print(json.dumps({'pages':len(seen), 'images':len(results), 'failures':len(failures)}), flush=True)
