import sys,struct
def write(parts):
    h=bytearray(165)
    p=b'\x06DAT5.0\x06TABDTA\x041.00'; h[:len(p)]=p; h[20]=3
    struct.pack_into('<H',h,23,len(parts))
    out=bytes(h)
    for L,W,a,b,grain,q,name in parts:
        r=bytearray(79); struct.pack_into('<II',r,0,L,W); r[8]=a; r[9]=b; r[29]=grain
        struct.pack_into('<H',r,31,q); n=name.encode('cp1250')[:25]; r[53]=len(n); r[54:54+len(n)]=n
        out+=bytes(r)
    return out
for f in sys.argv[1:]:
    d=open(f,'rb').read(); parts=[]
    for i in range((len(d)-165)//79):
        r=d[165+i*79:165+(i+1)*79]; L,W=struct.unpack('<II',r[:8])
        parts.append((L,W,r[8],r[9],r[29],struct.unpack('<H',r[31:33])[0],r[54:54+r[53]].decode('cp1250')))
    w=write(parts); print(f, 'IDENTICAL' if w==d else 'DIFF', len(w), len(d))
    # check name padding bytes beyond length are zero
    print(' nonzero after names:', sum(1 for i in range((len(d)-165)//79) for x in d[165+i*79+54+d[165+i*79+53]:165+(i+1)*79] if x))
