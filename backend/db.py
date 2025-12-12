import psycopg
from contextlib import contextmanager


@contextmanager
def get_db():
    """
    Ouvre une connexion à la base 'prospector',
    la donne à la fonction appelante,
    puis la ferme proprement.
    """
    conn = psycopg.connect("dbname=prospector")
    try:
        yield conn
    finally:
        conn.close()
