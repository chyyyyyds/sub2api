"""验证迁移转换中的金额、排除规则和不支持的数据必须拒绝等关键约束。"""
import copy
import unittest

from newapi_migration import prepare


class MigrationConversionTest(unittest.TestCase):
    def snapshot(self):
        return dict(source_system='oracle-newapi-main',quota_per_unit=500000,unsupported_features={},
                    users=[dict(id=3,username='旧用户名',email='old@example.com',password='$2a$fixture',role=1,status=1,
                                quota=123456,created_at=1,last_login_at=2),
                           dict(id=1,email='',username='chyyds'),dict(id=2,email='chenhanyu987@gmail.com')],
                    keys=[dict(id=8,user_id=3,key='a'*48,status=2,name='原 Key',created_time=1,expired_time=-1,
                               remain_quota=100000,used_quota=50000,unlimited_quota=False,
                               group='生图',model_limits_enabled=True,allow_ips='')],
                    codes=[dict(id=9,key='b'*32,status=3,quota=500000,created_time=1,redeemed_time=2,
                                used_user_id=2,expired_time=0)])

    def test_money_ownership_disabled_state_and_used_codes(self):
        rows,summary=prepare(self.snapshot())
        self.assertEqual((summary['users'],summary['keys'],summary['codes']),(1,1,1))
        user,key,code=[r['payload'] for r in rows]
        self.assertEqual(user['balance'],'0.24691200')
        self.assertEqual(key['key'],'sk-'+'a'*48)
        self.assertEqual(key['group_id'],3)
        self.assertEqual(key['status'],'disabled')
        self.assertEqual((key['quota'],key['quota_used']),('0.30000000','0.10000000'))
        self.assertEqual(code['status'],'used')
        self.assertIsNone(code['user_source_id'])
        self.assertEqual(summary['unused_code_value_total'],'0')

    def test_video_and_empty_groups_are_not_imported(self):
        snapshot=self.snapshot()
        for group in ['', 'seedance视频生成', '视频生成（稳定版）']:
            snapshot['keys'][0]['group']=group
            rows,summary=prepare(snapshot)
            self.assertEqual(summary['keys'],0)

    def test_unreviewed_groups_limits_auth_features_and_collisions_fail(self):
        original=self.snapshot()
        changes=[lambda s:s['keys'][0].update(group='未知新分组'),
                 lambda s:s['keys'][0].update(allow_ips='127.0.0.1'),
                 lambda s:s.update(unsupported_features={'enabled_two_fa':1}),
                 lambda s:s['users'].append(dict(s['users'][0],id=4))]
        for change in changes:
            snapshot=copy.deepcopy(original)
            change(snapshot)
            with self.assertRaises(ValueError): prepare(snapshot)


if __name__=='__main__':
    unittest.main()
