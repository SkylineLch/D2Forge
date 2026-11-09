import struct, sys, os

VPK_SIG = 0x55aa1234

def read_cstring(f):
    out = bytearray()
    while True:
        b = f.read(1)
        if not b or b == b'\x00':
            return out.decode('utf-8', errors='replace')
        out += b

def parse_tree(vpk_path, keywords=None, limit=None):
    """Walk VPK directory tree; yield (ext, path, name, crc32, preload_len, archive_index, entry_offset, entry_len)."""
    hits = []
    total_entries = 0
    with open(vpk_path, 'rb') as f:
        hdr = f.read(12)
        if len(hdr) < 12:
            return hits, total_entries
        sig, version, tree_len = struct.unpack('<III', hdr)
        if sig != VPK_SIG:
            raise ValueError(f'bad signature {sig:#x}')
        header_len = 12 if version == 1 else 28
        f.seek(header_len)
        tree_end = header_len + tree_len
        while True:
            ext = read_cstring(f)
            if ext == '':
                break
            while True:
                path = read_cstring(f)
                if path == '':
                    break
                while True:
                    name = read_cstring(f)
                    if name == '':
                        break
                    total_entries += 1
                    meta = f.read(18)
                    crc32, preload_len, archive_index, entry_offset, entry_len, suffix = struct.unpack('<IHHIIH', meta)
                    full = f'{path}/{name}.{ext}' if path else f'{name}.{ext}'
                    if keywords is None or any(k.lower() in full.lower() for k in keywords):
                        hits.append((full, crc32, preload_len, archive_index, entry_offset, entry_len, suffix))
                        if limit and len(hits) >= limit:
                            # keep scanning total but stop collecting
                            pass
            # after extensions done
    return hits, total_entries

if __name__ == '__main__':
    vpk = sys.argv[1]
    kws = sys.argv[2:] or None
    try:
        hits, total = parse_tree(vpk, kws)
        print(f'TOTAL_ENTRIES={total}')
        print(f'HITS={len(hits)}')
        for h in hits[:200]:
            full, crc32, pl, ai, eo, el, suf = h
            print(f'{full}\tarchive={ai}\toffset={eo}\tlen={el}\tpreload={pl}\tsuffix={suf:#x}')
    except Exception as e:
        print(f'ERROR: {e}')
        sys.exit(1)
