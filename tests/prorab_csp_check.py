"""Execute the actual response-header hook without booting the server/database."""
import ast
from pathlib import Path
from types import SimpleNamespace as NS
import unittest

ROOT = Path(__file__).resolve().parents[1]


def headers_for(endpoint, path):
    tree = ast.parse((ROOT / 'app.py').read_text(encoding='utf-8'))
    hook = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == 'headers')
    hook.decorator_list = []
    constants = [n for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in ('PRORAB_CONNECT', 'PRORAB_GEO') for t in n.targets)]
    code = ast.Module(body=constants + [hook], type_ignores=[])
    namespace = {
        'request': NS(endpoint=endpoint, path=path),
        'analytics': NS(settings=lambda: {}, allowed=lambda: False),
        'PUBLIC_ENDPOINTS': set(), 'production': False,
        'seo': NS(get=lambda _: None, enabled=lambda: False),
    }
    exec(compile(ast.fix_missing_locations(code), 'app.py:headers', 'exec'), namespace)
    response = NS(headers={}, status_code=200, mimetype='text/html')
    return namespace['headers'](response).headers


class GalleryPolicyTest(unittest.TestCase):
    def test_shared_gallery_video_uses_existing_disk_hosts(self):
        csp = headers_for('prorab_shared', '/prorab')['Content-Security-Policy']
        media = next(d.strip() for d in csp.split(';') if d.strip().startswith('media-src'))
        self.assertIn("media-src 'self'", media)
        self.assertIn('https://*.disk.yandex.net', media)
        self.assertIn('https://*.storage.yandex.net', media)
        self.assertNotIn(' *', media)
        self.assertNotIn('unsafe-inline', csp)

    def test_admin_gallery_video_and_existing_download_policy(self):
        csp = headers_for('prorab', '/admin/prorab')['Content-Security-Policy']
        self.assertIn("media-src 'self'", csp)
        self.assertIn("connect-src 'self' https://cloud-api.yandex.net", csp)
        self.assertIn("object-src 'none'", csp)

    def test_other_pages_have_no_extra_media_permission(self):
        csp = headers_for('admin', '/admin')['Content-Security-Policy']
        self.assertNotIn('media-src', csp)
        self.assertNotIn('disk.yandex', csp)
        self.assertIn("default-src 'self'", csp)


if __name__ == '__main__':
    unittest.main()
