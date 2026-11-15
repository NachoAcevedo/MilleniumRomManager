# ExternalLauncherAutoClose

Complemento de Millennium para Windows que cierra automáticamente el launcher de un juego externo al terminar la última partida.

Copiá la carpeta completa **launcher-auto-close**, incluida **.millennium**, en **Steam\millennium\plugins**. Reiniciá Steam y habilitá **ExternalLauncherAutoClose** en Millennium.

En los ajustes del complemento podés elegir qué launchers se cierran y definir una espera global de 60 segundos por defecto. Si iniciás otro juego del mismo launcher mientras corre la espera, el cierre se cancela.

La detección usa el destino y los argumentos del acceso directo de Steam. Reconoce Epic Games, EA app, Ubisoft Connect, GOG Galaxy y Battle.net cuando el acceso permite identificar la tienda. Para Epic, también consulta el registro de instalaciones local para distinguir cuál es el proceso del juego aunque Steam siga mostrando el launcher como activo.
