"""Bundle index.html and its local CSS/JS into one self-contained offline HTML file."""
import re, sys, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
html = open(os.path.join(root, "index.html"), encoding="utf-8").read()
def css(m): return "<style>\n" + open(os.path.join(root, m.group(1)), encoding="utf-8").read() + "\n</style>"
def js(m):
    src = m.group(1)
    if src.startswith("http"): return ""
    return "<script>\n" + open(os.path.join(root, src), encoding="utf-8").read().replace("</script>", "<\\/script>") + "\n</script>"
html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', css, html)
html = re.sub(r'<script src="([^"]+)"></script>', js, html)
open(sys.argv[1], "w", encoding="utf-8").write(html)
print("offline bundle", len(html) // 1024, "KB")
