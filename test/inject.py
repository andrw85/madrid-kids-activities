import io
p = "cap/www/index.html"
s = open(p, encoding="utf-8").read()
inject = '<script src="engine.js"></script>\n<script src="api-shim.js"></script>\n</head>'
assert "</head>" in s, "no head tag"
assert "engine.js" not in s, "already injected"
s = s.replace("</head>", inject, 1)
open(p, "w", encoding="utf-8").write(s)
print("injected engine.js + api-shim.js before </head>")
