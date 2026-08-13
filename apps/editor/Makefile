# Niveles del arnés. Un Makefile y no un script por tres razones: nombra los
# niveles y así se documentan solos, no añade ninguna dependencia, y `make
# lint` cabe justo al lado de los «comandos rápidos» de CLAUDE.md.
#
# `rapido` tiene que quedar POR DEBAJO DE 2 s o no se ejecutará, y un arnés que
# no se ejecuta no protege nada. Hoy va sobrado: 0,08 s de pruebas más 0,15 s
# de comprobaciones sobre los artefactos reales.
#
# El peor resultado posible en un repo cuyo valor entero está en los fallos que
# no dan error es una prueba verde que no mira nada. De ahí que el lint marque
# como DESCONOCIDA la plantilla que no consigue leer, en vez de como limpia.

# `?=` y no `:=`: el CI lo sobrescribe con `make PY=python ci`, porque en un
# runner no hay .venv. Con `:=` no se puede desde la línea de comandos.
PY ?= .venv/bin/python

.PHONY: piezas ayuda lint rapido pruebas comprobar reloj render lento oro sonido escuchar srt contacto portada publicar ci hooks instalar instalar-pipeline limpiar

ayuda:
	@echo "make lint       lint, relojes y monotonía            (< 1 s)"
	@echo "make pruebas    unitarias y contratos                (< 0,2 s)"
	@echo "make comprobar  los artefactos reales de build/      (~ 1 s)"
	@echo "make rapido     todo lo anterior                     (< 2 s)"
	@echo "make render     rápido + las 182 plantillas y goldens (~ 35 s)"
	@echo "make lento      render + la cadena completa          (~ 40 s)"
	@echo "make reloj      solo las cinco medidas del reloj"
	@echo "make sonido     la tabla de señales, en contexto     (~ 1 s)"
	@echo "make escuchar   fichas de escucha: sin / con / con +6"
	@echo "make srt        el .srt accesible del montaje       (< 1 s)"
	@echo "make oro        REGENERA los goldens. Nunca automático."
	@echo "make contacto   el catálogo en JPG, versionado en docs/media/ (~15 s)"
	@echo "make portada    el fotograma de portada, medido    PIEZA=... (~1,5 s)"
	@echo "make publicar   las siete medidas de la pieza YA MONTADA PIEZA=... (~8 s)"
	@echo "make piezas     las 10 de un guion con hooks  GUION=... [J=3] (~9 min)"
	@echo "make hooks      activa los ganchos de git de scripts/hooks/"
	@echo "make instalar   dependencias de desarrollo"

# --------------------------------------------------------------------------
# Cruza el plan con las 182 plantillas, el renderizador y el compositor. Es el
# único nivel que compara cuatro artefactos en dos lenguajes, y ninguna prueba
# unitaria puede cubrir eso.
lint:
	@$(PY) scripts/lint_config.py
	@$(PY) scripts/comprobar_relojes.py
	@$(PY) scripts/comprobar_docs.py
	@node scripts/auditar_estilo.js

# Funciones puras: el reloj, el director, el validador y los contratos. No
# necesitan ffmpeg, ni Playwright, ni vídeo.
pruebas:
	@$(PY) -m pytest tests/ -q

# Sobre los artefactos REALES de build/. Es lo que hace que el arnés proteja al
# que edita y no solo al que escribió las pruebas.
comprobar:
	@$(PY) scripts/comprobar_contratos.py
	@$(PY) scripts/comprobar_montaje.py
	@$(PY) scripts/comprobar_alfa.py

reloj:
	@$(PY) scripts/comprobar_reloj.py

rapido: lint pruebas comprobar
	@echo "\nnivel rápido en verde"

# Las 182 plantillas en Playwright y los goldens que necesitan navegador. El
# coste está medido: 0,158 s por plantilla, así que el catálogo entero cabe en
# el nivel de render y no hace falta que sea opt-in.
render: rapido
	@$(PY) -m pytest tests/ -q -m render
# Los dos que necesitan navegador y comparan PÍXELES, no texto. Van en `render`
# y no en `rapido` porque cada uno abre Chromium y rasteriza: 15 y 40 s.
	@node scripts/comprobar_eje.js
	@node scripts/comprobar_movimiento.js

# La cadena entera con el clip de 3 s: el único nivel que ejercita el
# filtergraph de ffmpeg y el único que puede probar la invariante de reloj de
# punta a punta.
lento: render
	@$(PY) -m pytest tests/ -q -m lento

# NUNCA automático: un golden creado sobre un bug lo convierte en
# especificación. `--diff` dice qué cambiaría sin escribir nada.
# Sonido. `sonido` mide sin renderizar vídeo (0,7 s); `escuchar` produce el
# banco de fichas para el juicio que ninguna medida puede dar.
sonido:
	@$(PY) scripts/banco_sonido.py --informe

escuchar:
	@$(PY) scripts/banco_sonido.py
	@echo "abre build/banco/ y escucha: sin el efecto, con él, y con él +6 dB"

# El OTRO canal de texto: el .srt que se sube junto al vídeo. Los subtítulos
# cinéticos van quemados en los píxeles y no los indexa la plataforma, no los
# lee un lector de pantalla y no se pueden traducir ni apagar.
#
# Va aparte del render y no colgado de él a propósito: sale de
# build/timeline.json, así que no necesita ni fotogramas ni ffmpeg y se puede
# regenerar cuando cambia la transcripción sin volver a montar nada.
srt:
	@$(PY) scripts/exportar_srt.py

# --------------------------------------------------------------------------
# El contacto VERSIONADO: la rejilla completa de cada tema, comprimida a JPG
# en docs/media/. Existe porque el agente guionista trabaja contra este repo
# sin Playwright y sin esta máquina: build/ es desechable y no viaja, así que
# hasta ahora su único catálogo era un mensaje de error.
#
# Dos pasadas de la hoja —una por tema— y no una con los temas apilados: el
# consumidor de estos JPG elige plantilla DENTRO de un tema, y la imagen
# apilada dobla el alto para responder otra pregunta (¿aguanta los dos?).
# Ojo: build/hoja_contactos.png queda con el ÚLTIMO tema; la hoja apilada de
# siempre sigue siendo `node scripts/hoja_contactos.js` a secas.
#
# La puerta de 1,5 MB no es estética: es el techo para que el par de imágenes
# se pueda mirar y versionar sin arrastrar el repo. Si algún día se supera,
# el mensaje dice exactamente dónde tocar.
FFMPEG ?= /opt/homebrew/bin/ffmpeg

contacto:
	@mkdir -p docs/media
	@node scripts/hoja_contactos.js --tema carbon > /dev/null
	@$(FFMPEG) -nostdin -y -loglevel error -i build/hoja_contactos.png -q:v 7 docs/media/catalogo-carbon.jpg
	@node scripts/hoja_contactos.js --tema paper > /dev/null
	@$(FFMPEG) -nostdin -y -loglevel error -i build/hoja_contactos.png -q:v 7 docs/media/catalogo-paper.jpg
	@for j in docs/media/catalogo-carbon.jpg docs/media/catalogo-paper.jpg; do \
	  peso=$$(stat -f%z $$j); \
	  if [ $$peso -gt 1500000 ]; then \
	    echo "$$j pesa $$peso bytes (>1,5 MB): sube -q:v en el target contacto"; exit 1; \
	  fi; \
	  echo "$$j  $$peso bytes"; \
	done

# --------------------------------------------------------------------------
# La PORTADA: el fotograma que la plataforma enseña en el feed. Sin este paso
# lo elige ella, y elige el 0 — que en la pieza de Codex es el más borroso de
# todo el arranque y va sin ningún gráfico, porque el primero entra en 0,55 s.
#
# Pide la PIEZA y no adivina un valor por defecto: en renders/ conviven piezas,
# catálogos y pruebas de sonido, y una portada de la pieza equivocada no da
# error en ningún sitio — sale un JPG perfecto del vídeo que no es.
#
# No va dentro de `rapido` ni de `lento`: no comprueba nada, PRODUCE algo, y lo
# que produce depende de qué pieza se esté publicando ese día.
portada:
	@test -n "$(PIEZA)" || { \
	  echo "dime la pieza:  make portada PIEZA=renders/<pieza>.mp4"; exit 2; }
	@$(PY) scripts/portada.py --input $(PIEZA)

# --------------------------------------------------------------------------
# La pieza TERMINADA, medida entera y de una vez.
#
# `rapido`, `render` y `lento` vigilan los ARTEFACTOS: el plan, el manifiesto,
# los fotogramas, los contratos. Ninguno mira la pieza que se sube. Los siete
# que sí la miran existían todos —y dos, `comprobar_ritmo.py` y `colocar.py
# --plataforma`, ni siquiera aparecían en este fichero—, así que publicar
# dependía de acordarse de siete comandos, y el que se olvida no da error:
# da una pieza publicada con los subtítulos debajo del CTA de la app.
#
# Los siete se ejecutan TODOS aunque alguno falle, y el veredicto va al final.
# Parar en el primero convierte la revisión en siete rondas: arreglas el
# ritmo, y solo entonces te enteras de que además el sonido está plano.
#
# `srt` y `portada` PRODUCEN, no comprueban, y están aquí a propósito: son
# las dos cosas que acompañan al mp4 en la subida —el texto que la plataforma
# indexa y el fotograma que enseña— y las dos se olvidan igual de fácil.
PLATAFORMA ?= reels

publicar:
	@test -n "$(PIEZA)" || { \
	  echo "dime la pieza:  make publicar PIEZA=renders/<pieza>.mp4"; exit 2; }
	@test -f "$(PIEZA)" || { \
	  echo "$(PIEZA) no existe. Las piezas montadas están en renders/"; exit 2; }
	@fallos=0; \
	echo "── montaje ─────────── ¿plan, manifiesto y fotogramas son de ESTA pieza?"; \
	$(PY) scripts/comprobar_montaje.py || fallos=`expr $$fallos + 1`; \
	echo ""; echo "── alfa ────────────── ¿alguna secuencia mezcla formatos de PNG?"; \
	$(PY) scripts/comprobar_alfa.py || fallos=`expr $$fallos + 1`; \
	echo ""; echo "── ritmo ───────────── ¿cada cuánto entra algo nuevo?"; \
	$(PY) scripts/comprobar_ritmo.py --mezcla $(PIEZA) || fallos=`expr $$fallos + 1`; \
	echo ""; echo "── sonido ──────────── sonoridad, techo, dinámica y capas sin cue"; \
	$(PY) scripts/comprobar_sonido.py || fallos=`expr $$fallos + 1`; \
	echo ""; echo "── plataforma ──────── qué gráficos quedan bajo lo que pinta $(PLATAFORMA)"; \
	$(PY) scripts/colocar.py --plan build/plan.json --plataforma $(PLATAFORMA) \
	  || fallos=`expr $$fallos + 1`; \
	echo ""; echo "── srt ─────────────── el texto que la plataforma SÍ indexa"; \
	$(PY) scripts/exportar_srt.py --video $(PIEZA) || fallos=`expr $$fallos + 1`; \
	echo ""; echo "── portada ─────────── el fotograma del feed, elegido midiendo"; \
	$(PY) scripts/portada.py --input $(PIEZA) || fallos=`expr $$fallos + 1`; \
	echo ""; \
	if [ $$fallos -gt 0 ]; then \
	  echo "$$fallos de 7 medidas en ROJO sobre $(PIEZA): mira arriba antes de subir"; \
	  exit 1; \
	fi; \
	echo "las 7 medidas en verde sobre $(PIEZA)"

# Las DIEZ piezas de una grabación: cinco hooks x dos variantes de edición.
#
# En PARALELO, tres a la vez por defecto (`J=` lo cambia). Cada una trabaja en
# su `build/piezas/<id>/` vía `EDITOR_BUILD`, que es lo que hacía falta:
# compartir un solo `build/` obligaba a ir en serie porque cada montaje pisa
# el plan, el manifiesto y los fotogramas del anterior — el desajuste que
# `comprobar_montaje.py` existe para cazar.
#
# Tres y no diez porque cada pieza abre su Chromium y rasteriza miles de
# fotogramas: el techo es la memoria, no los núcleos. Medido con dos: 3:20
# para las dos, 741 % de CPU.
piezas:
	@test -n "$(GUION)" || { \
	  echo "dime el guion:  make piezas GUION=guiones/<idea>.json"; exit 2; }
	@$(PY) scripts/piezas.py $(GUION) --montar -j $(or $(J),3)

# Lo que se puede correr en un CLON LIMPIO: sin build/, sin metraje, sin
# navegador y sin ffmpeg. Es lo que corre el CI.
#
# `lint_config.py` NO entra: su valor por defecto es build/plan.json, que en un
# clon no existe. Y `render`/`lento` tampoco, y no por pereza — las fuentes del
# runner no son las de esta máquina, así que la comprobación tipográfica y los
# goldens de maquetación darían rojo siempre. Un CI que falla al azar se
# desactiva y se lleva por delante a las pruebas buenas.
ci:
	@$(PY) scripts/comprobar_relojes.py
	@$(PY) scripts/comprobar_docs.py
	@node scripts/auditar_estilo.js
	@$(PY) -m pytest tests/ -q

# Los ganchos de git, VERSIONADOS en scripts/hooks/. Se apunta con
# `core.hooksPath` en vez de copiar a .git/hooks: una copia se queda vieja en
# cuanto alguien edita el original y nadie lo nota, porque .git/ no viaja con
# el repo. Esto es un puntero, así que el hook que corre es siempre el que
# está en el árbol.
#
# Hay que ejecutarlo UNA VEZ POR CLON —git no activa ganchos solo—, y por eso
# el target existe: un gancho que se activa con tres comandos copiados de un
# README acaba activo en una máquina de cada tres.
hooks:
#	`core.hooksPath` apuntando a un directorio que no existe hace que git NO
#	ejecute NINGÚN gancho, y no dice ni una palabra: quedaría un repo que se
#	cree protegido y no lo está. Se comprueba ANTES de apuntar.
	@test -d scripts/hooks || { \
	  echo "falta scripts/hooks/ — sin él, core.hooksPath apagaría los ganchos"; \
	  echo "  lo arregla:  git checkout scripts/hooks"; exit 1; }
	@git config core.hooksPath scripts/hooks
	@chmod +x scripts/hooks/*
	@echo "core.hooksPath = $$(git config --get core.hooksPath)"
	@echo "  pre-commit  techo de 2 MB por blob, y nada de mp4/mov/m4a fuera de tests/fixtures/   (0,05 s)"
	@echo "  pre-push    make rapido                                                              (6 s)"
	@echo "  desactivar  git config --unset core.hooksPath"
	@if [ -d .githooks ]; then \
	  echo ""; \
	  echo "  ojo: .githooks/ sigue versionado y ya NO está activo. Es la copia anterior"; \
	  echo "  —su pre-commit corría 'make lint pruebas', 6 s, y por eso se saltaba—."; \
	  echo "  Si nadie la reclama:  git rm -r .githooks"; \
	fi

oro:
	@$(PY) scripts/oro.py

instalar-pipeline:
	@$(PY) -m pip install -q -r requirements.txt
	@npm install --silent
	@test -f assets/luts/carbon_bronze.cube || $(PY) scripts/make_lut.py

instalar:
	@$(PY) -m pip install -q -r requirements-dev.txt
	@$(PY) -m pytest --version

# Las copias de conflicto de iCloud, que el sincronizador deja al vaciar un
# directorio de fotogramas. No son del proyecto y arrastran a cualquier
# herramienta que recorra un glob.
limpiar:
	@find build/frames -maxdepth 1 -type d -name '* [0-9]' -exec rm -rf {} + 2>/dev/null || true
	@find . -name '__pycache__' -type d -not -path './.venv/*' -exec rm -rf {} + 2>/dev/null || true
	@echo "conflictos de iCloud y cachés de Python fuera"
