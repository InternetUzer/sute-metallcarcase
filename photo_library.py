"""Owner-managed photos stored on the persistent data volume."""
from io import BytesIO
import secrets
import warnings

from flask import abort, flash, redirect, request, send_file, url_for
from PIL import Image, ImageOps, UnidentifiedImageError


def convert_photo(payload):
    if not payload or len(payload) > 10 * 1024 * 1024:
        raise ValueError('Выберите JPG, PNG или WebP размером до 10 МБ.')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(payload)) as source:
                if source.format not in ('JPEG', 'PNG', 'WEBP'):
                    raise ValueError('Допустимы только фотографии JPG, PNG и WebP.')
                if source.width * source.height > 24_000_000:
                    raise ValueError('Разрешение фотографии не должно превышать 24 мегапикселя.')
                if getattr(source, 'n_frames', 1) != 1:
                    raise ValueError('Выберите неподвижное изображение без анимации.')
                source.load()
                image = ImageOps.exif_transpose(source)
                image.thumbnail((2400, 2400))
                image = image.convert('RGBA' if 'A' in image.getbands() or 'transparency' in image.info else 'RGB')
                image.info.clear()
                output = BytesIO()
                image.save(output, 'WEBP', quality=85)
                return output.getvalue(), image.width, image.height
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ValueError('Фотография повреждена или слишком большая. Выберите другой файл.') from None


def register_photos(app, db, protected, render, data):
    folder = data / 'media'
    folder.mkdir(exist_ok=True)
    with app.app_context():
        db().execute('''CREATE TABLE IF NOT EXISTS photos(
            id INTEGER PRIMARY KEY, storage_name TEXT UNIQUE NOT NULL,
            title TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)''')
        db().commit()

    @app.route('/admin/photos', methods=['GET', 'POST'])
    @protected(admin=True)
    def photos():
        error = None
        if request.method == 'POST':
            target = None
            try:
                title = request.form.get('title', '').strip()
                upload = request.files.get('photo')
                if not title or len(title) > 160:
                    raise ValueError('Укажите название фотографии длиной до 160 символов.')
                if not upload:
                    raise ValueError('Выберите фотографию.')
                payload, width, height = convert_photo(upload.read(10 * 1024 * 1024 + 1))
                storage = secrets.token_hex(24) + '.webp'
                target = folder / storage
                target.write_bytes(payload)
                db().execute('INSERT INTO photos(storage_name,title,width,height) VALUES(?,?,?,?)',
                             (storage, title, width, height))
                db().commit()
                flash('Фотография загружена. Теперь её можно выбрать при создании публикации.')
                return redirect(url_for('photos'))
            except ValueError as exc:
                db().rollback()
                if target:
                    target.unlink(missing_ok=True)
                error = str(exc)
            except Exception:
                db().rollback()
                if target:
                    target.unlink(missing_ok=True)
                raise
        return render('photos.html', 'Фотографии — Металл-Каркас',
                      photos=db().execute('SELECT * FROM photos ORDER BY id DESC').fetchall(), error=error), 422 if error else 200

    @app.get('/admin/photos/<int:photo_id>/image')
    @protected(admin=True)
    def photo_preview(photo_id):
        photo = db().execute('SELECT * FROM photos WHERE id=?', (photo_id,)).fetchone()
        if not photo:
            abort(404)
        return send_file(folder / photo['storage_name'], mimetype='image/webp')

    @app.get('/media/<storage>')
    def public_photo(storage):
        photo = db().execute('''SELECT p.storage_name FROM photos p WHERE p.storage_name=?
            AND EXISTS(SELECT 1 FROM showcases s WHERE s.image=? AND s.published=1)''',
            (storage, '/media/' + storage)).fetchone()
        if not photo:
            abort(404)
        response = send_file(folder / photo['storage_name'], mimetype='image/webp')
        response.headers['Cache-Control'] = 'no-store'
        return response
