# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

from PyInstaller.utils.hooks import collect_all, copy_metadata


BACKEND_DIR = Path(SPECPATH).resolve().parent

datas = [
    (str(BACKEND_DIR / "media" / "DouyinSansBold.otf"), "media"),
]
datas += copy_metadata("imageio")
datas += copy_metadata("imageio_ffmpeg")
datas += copy_metadata("moviepy")
binaries = []
hiddenimports = []

packages_to_collect = [
    "arkitect",
    "cryptography",
    "dotenv",
    "fastapi",
    "imageio_ffmpeg",
    "moviepy",
    "pydantic",
    "requests",
    "starlette",
    "tos",
    "uvicorn",
    "volcengine",
    "volcenginesdkarkruntime",
    "websockets",
]

for package_name in packages_to_collect:
    package_datas, package_binaries, package_hiddenimports = collect_all(package_name)
    datas += package_datas
    binaries += package_binaries
    hiddenimports += package_hiddenimports

a = Analysis(
    [str(BACKEND_DIR / "index.py")],
    pathex=[str(BACKEND_DIR)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "IPython",
        "matplotlib",
        "pytest",
        "tkinter",
    ],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="chat2cartoon-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="chat2cartoon-backend",
)
