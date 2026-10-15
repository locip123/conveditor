import base64
import binascii
from io import BytesIO

from PIL import Image, UnidentifiedImageError

from conveditor.schemas.workflow import Region


def normalize_image(raw: bytes) -> bytes:
    if len(raw) > 12_000_000:
        raise ValueError("图片超过 12 MB，请缩小后重试")
    try:
        with Image.open(BytesIO(raw)) as image:
            if image.format not in {"PNG", "JPEG", "WEBP"}:
                raise ValueError("仅支持 PNG、JPEG 或 WebP 图片")
            if image.width * image.height > 16_000_000:
                raise ValueError("图片分辨率过大")
            image.load()
            image.thumbnail((1024, 1024))
            output = BytesIO()
            image.convert("RGBA").save(output, format="PNG")
            return output.getvalue()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("图片内容无法解码") from exc


def decode_image(data_url: str) -> bytes:
    header, separator, encoded = data_url.partition(",")
    if not separator or header not in {"data:image/png;base64", "data:image/jpeg;base64", "data:image/webp;base64"}:
        raise ValueError("请提交 PNG、JPEG 或 WebP 的 base64 图片")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError("图片编码无效") from exc
    return normalize_image(raw)


def region_box(size: tuple[int, int], region: Region) -> tuple[int, int, int, int]:
    w, h = size
    box = (int(region.x * w), int(region.y * h), min(w, round((region.x + region.width) * w)), min(h, round((region.y + region.height) * h)))
    if box[2] <= box[0] or box[3] <= box[1]:
        raise ValueError("选区太小，请重新框选")
    return box


def crop_region(source: bytes, region: Region) -> bytes:
    with Image.open(BytesIO(source)) as image:
        output = BytesIO()
        image.crop(region_box(image.size, region)).save(output, format="PNG")
        return output.getvalue()


def region_mask(source: bytes, region: Region) -> bytes:
    with Image.open(BytesIO(source)) as image:
        mask = Image.new("RGBA", image.size, (255, 255, 255, 255))
        mask.paste((255, 255, 255, 0), region_box(image.size, region))
        output = BytesIO()
        mask.save(output, format="PNG")
        return output.getvalue()


def preserve_outside_region(source: bytes, generated: bytes, region: Region) -> bytes:
    original = Image.open(BytesIO(source)).convert("RGBA")
    candidate = Image.open(BytesIO(generated)).convert("RGBA").resize(original.size, Image.Resampling.LANCZOS)
    mask = Image.open(BytesIO(region_mask(source, region))).getchannel("A")
    result = Image.composite(original, candidate, mask)
    output = BytesIO()
    result.save(output, format="PNG")
    return output.getvalue()
