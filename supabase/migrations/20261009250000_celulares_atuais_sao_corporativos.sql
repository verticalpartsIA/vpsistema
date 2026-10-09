-- O Gelson confirmou (09/10/2026): todos os celulares cadastrados hoje são
-- CORPORATIVOS. A migração 20261009180000 os tinha colocado em "pessoal" por
-- não saber; aqui eles passam para "corporativo". O número de notificação
-- (`celular`) não muda — continua sendo o mesmo telefone.
update public.profiles
set celular_corporativo = celular_pessoal,
    celular_pessoal     = null
where celular_corporativo is null
  and celular_pessoal is not null;
