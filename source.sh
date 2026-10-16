#!/bin/bash

PROJECT_DIR="$(pwd)"
cd "$PROJECT_DIR" || exit 1

VENV_DIR=".venv"
VENV_PYTHON="$VENV_DIR/bin/python3"

# Fonction pour (re)créer un venv propre
create_venv() {
    echo "👉 Création de l'environnement virtuel..."
    python3 -m venv "$VENV_DIR" || {
        echo "❌ Impossible de créer le venv. Vérifie que python3-venv est installé :"
        echo "   sudo apt install python3-venv python3-full"
        exit 1
    }
}

# Vérifie que le venv existe et est fonctionnel
if [ ! -d "$VENV_DIR" ] || [ ! -x "$VENV_PYTHON" ]; then
    echo "❌ Environnement virtuel introuvable ou incomplet."
    rm -rf "$VENV_DIR"
    create_venv
fi

# Activation du venv
source "$VENV_DIR/bin/activate"

# Vérification que le python actif est bien celui du venv
ACTIVE_PYTHON="$(which python3)"
if [[ "$ACTIVE_PYTHON" != "$PROJECT_DIR/$VENV_DIR"* ]]; then
    echo "⚠️  Le venv semble corrompu (python3 pointe vers $ACTIVE_PYTHON)."
    echo "👉 Recréation du venv..."
    deactivate 2>/dev/null
    rm -rf "$VENV_DIR"
    create_venv
    source "$VENV_DIR/bin/activate"
fi

echo "✅ Projet WinWeb"
echo "📁 $(pwd)"
echo "🐍 Python : $(which python3)"

# Mise à jour de pip (évite pas mal de soucis d'installation)
python3 -m pip install --upgrade pip >/dev/null 2>&1

# Test de Flask
if python3 -c "import flask" 2>/dev/null; then
    FLASK_VERSION=$(python3 -c "import flask; print(flask.__version__)" 2>/dev/null)
    echo "🌐 Flask : installé (version $FLASK_VERSION)"
else
    echo "❌ Flask n'est pas installé dans le .venv."
    echo "👉 Installation de Flask..."

    python3 -m pip install flask || {
        echo "❌ Échec de l'installation de Flask."
        exit 1
    }

    FLASK_VERSION=$(python3 -c "import flask; print(flask.__version__)" 2>/dev/null)
    echo "✅ Flask installé (version $FLASK_VERSION)"
fi

echo "🚀 Lance Flask avec : python3 app.py"
echo

python3 app.py
