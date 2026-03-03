-- Force PostgREST to reload its schema cache by sending a NOTIFY
NOTIFY pgrst, 'reload schema';
