-- "Diretoria" soava como departamento; Diego Maeno é CEO, não diretor.
update public.profiles set department = 'CEO' where email = 'diego@verticalparts.com.br';
