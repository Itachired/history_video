from pathlib import Path
import binascii
import struct
import zlib


def chunk(kind, data):
    return (
        struct.pack(">I", len(data))
        + kind
        + data
        + struct.pack(">I", binascii.crc32(kind + data) & 0xFFFFFFFF)
    )


def make_png(size):
    rows = []
    pad = max(1, size // 16)
    radius = max(2, size // 5)
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            inside = pad <= x < size - pad and pad <= y < size - pad
            if inside:
                cx = min(max(x, pad + radius), size - pad - radius - 1)
                cy = min(max(y, pad + radius), size - pad - radius - 1)
                inside = (x - cx) * (x - cx) + (y - cy) * (y - cy) <= radius * radius
            if not inside:
                row.extend((0, 0, 0, 0))
                continue

            t = y / max(1, size - 1)
            red = int(30 + 18 * (1 - t))
            green = int(43 + 18 * (1 - t))
            blue = int(58 + 20 * (1 - t))
            alpha = 255

            book_x0, book_x1 = int(size * 0.22), int(size * 0.72)
            book_y0, book_y1 = int(size * 0.26), int(size * 0.74)
            if book_x0 <= x <= book_x1 and book_y0 <= y <= book_y1:
                red, green, blue = 240, 232, 210
                if abs(x - int(size * 0.47)) <= max(1, size // 80):
                    red, green, blue = 200, 190, 170

            tri_left = size * 0.43
            tri_right = size * 0.76
            if tri_left <= x <= tri_right:
                half_height = (x - tri_left) * 0.62
                if abs(y - size * 0.50) <= half_height:
                    red, green, blue = 214, 65, 54

            row.extend((red, green, blue, alpha))
        rows.append(bytes(row))

    raw = b"".join(rows)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    return png


def write_ico(output_path):
    sizes = [16, 32, 48, 64, 128, 256]
    images = [make_png(size) for size in sizes]
    header = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    entries = []
    for size, data in zip(sizes, images):
        width_byte = 0 if size == 256 else size
        entries.append(
            struct.pack("<BBBBHHII", width_byte, width_byte, 0, 0, 1, 32, len(data), offset)
        )
        offset += len(data)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(header + b"".join(entries) + b"".join(images))


if __name__ == "__main__":
    out = Path(__file__).resolve().parents[1] / "desktop" / "build" / "icon.ico"
    write_ico(out)
    print(out)
