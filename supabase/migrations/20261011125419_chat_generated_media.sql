-- Keep the image in the same atomic turn as its message, including on reload.
create function public.piskou_chat_finish_media(p_id uuid, p_lease uuid, p_user text, p_reply text, p_media jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare s public.piskou_chat_sessions%rowtype;
begin
  select * into s from public.piskou_chat_sessions where id=p_id for update;
  if not found or s.lease is distinct from p_lease then raise exception 'Chat lease invalid'; end if;
  if p_media is not null and (length(p_media::text) > 1500100 or p_media->>'src' not like 'data:image/jpeg;base64,%') then
    raise exception 'Invalid media';
  end if;
  s.messages := s.messages || jsonb_build_array(jsonb_build_object('role','user','text',p_user),jsonb_strip_nulls(jsonb_build_object('role','character','text',p_reply,'media',p_media)));
  update public.piskou_chat_sessions set messages=s.messages,lease=null,lease_until=null where id=p_id;
  return s.messages;
end;
$$;
revoke all on function public.piskou_chat_finish_media(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.piskou_chat_finish_media(uuid,uuid,text,text,jsonb) to service_role;
