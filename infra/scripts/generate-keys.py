import os
import sys
import shutil

# Force UTF-8 output on Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

try:
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives import serialization
except ImportError:
    print("Installing cryptography package...")
    os.system(f'"{sys.executable}" -m pip install cryptography -q')
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives import serialization

# Generate 2048-bit RSA key pair
private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

private_pem = private_key.private_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PrivateFormat.TraditionalOpenSSL,
    encryption_algorithm=serialization.NoEncryption(),
).decode("utf-8")

public_pem = private_key.public_key().public_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PublicFormat.SubjectPublicKeyInfo,
).decode("utf-8")

# Write PEM files
with open("private.pem", "w", encoding="utf-8") as f:
    f.write(private_pem)
with open("public.pem", "w", encoding="utf-8") as f:
    f.write(public_pem)

print("private.pem written")
print("public.pem written")

# Bootstrap .env from .env.example if needed
env_path = ".env"
if not os.path.exists(env_path):
    if os.path.exists(".env.example"):
        shutil.copy(".env.example", env_path)
        print(".env created from .env.example")
    else:
        with open(env_path, "w", encoding="utf-8") as f:
            f.write("")

# Inline the keys into .env (escape newlines so the file stays single-line per variable)
priv_escaped = private_pem.replace("\n", "\\n")
pub_escaped  = public_pem.replace("\n", "\\n")

with open(env_path, "r", encoding="utf-8") as f:
    lines = f.readlines()

new_lines = []
priv_found = False
pub_found  = False
for line in lines:
    if line.startswith("JWT_PRIVATE_KEY="):
        new_lines.append('JWT_PRIVATE_KEY="' + priv_escaped + '"\n')
        priv_found = True
    elif line.startswith("JWT_PUBLIC_KEY="):
        new_lines.append('JWT_PUBLIC_KEY="' + pub_escaped + '"\n')
        pub_found = True
    else:
        new_lines.append(line)

if not priv_found:
    new_lines.append('\nJWT_PRIVATE_KEY="' + priv_escaped + '"\n')
if not pub_found:
    new_lines.append('JWT_PUBLIC_KEY="' + pub_escaped + '"\n')

with open(env_path, "w", encoding="utf-8") as f:
    f.writelines(new_lines)

print(".env updated with JWT_PRIVATE_KEY and JWT_PUBLIC_KEY")
print("")
print("Key generation complete!")
print("Files: private.pem  public.pem  .env")
print("NOTE: Never commit private.pem or .env to git (already in .gitignore)")
